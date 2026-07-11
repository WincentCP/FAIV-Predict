import os
import sys
import pytest
from fastapi.testclient import TestClient

# Adjust path to import app correctly
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.main import app

client = TestClient(app)

# The ML service enforces a shared internal token when INTERNAL_API_TOKEN is set
# (as it is via ml-service/.env). Send it on every request, mirroring the BFF.
_token = os.getenv("INTERNAL_API_TOKEN")
if _token:
    client.headers.update({"X-Internal-Token": _token})


def test_predict_requires_internal_token_when_configured():
    """When a token is configured, unauthenticated requests are rejected."""
    if not _token:
        return  # auth disabled in this environment; nothing to assert
    resp = TestClient(app).post("/predict", json={
        "caption": "hi", "format": "Reels", "post_hour": 19,
    })
    assert resp.status_code == 401

def test_predict_endpoint_no_model_is_honest():
    """
    Without a configured database / trained model, the service must return an
    honest 503 (no fabricated fallback prediction).
    """
    payload = {
        "caption": "Get our exclusive discount of 20% now! Order today by visiting our bio links. #promo #discount #shopping",
        "format": "Carousel",
        "post_hour": 19,
        "brand_id": "bfd6dbca-613d-4950-8b1e-45ad7dcf1088",
        "niche": "Fashion"
      }
    response = client.post("/predict", json=payload)
    assert response.status_code == 503
    assert "detail" in response.json()

def test_suggest_endpoint():
    """Verify that the template recommendation engine returns proper heuristics advice."""
    payload = {
        "caption": "A short draft post.",
        "format": "Single Image",
        "post_hour": 9,
        "brand_id": "bfd6dbca-613d-4950-8b1e-45ad7dcf1088"
    }
    response = client.post("/suggest", json=payload)
    assert response.status_code == 200
    
    data = response.json()
    assert data["status"] == "success"
    assert "features_analyzed" in data
    assert "recommendations" in data
    
    # Assert details are returned
    recs = data["recommendations"]
    assert len(recs) > 0
    # The hour 9 is outside peak window (17-21) and caption is short, should recommend changes
    parameters_flagged = [r["parameter"] for r in recs]
    assert "post_hour" in parameters_flagged
    assert "caption_length" in parameters_flagged
    assert "has_cta" in parameters_flagged

def test_train_endpoint():
    """Verify that retraining queueing works asynchronously."""
    payload = {
        "brand_id": "bfd6dbca-613d-4950-8b1e-45ad7dcf1088",
        "niche": "Fashion"
    }
    response = client.post("/train", json=payload)
    assert response.status_code == 200
    
    data = response.json()
    assert data["status"] == "pending"
    assert "job_id" in data
    assert "message" in data

def test_train_status_without_db_is_honest():
    """Without a database there is no job state — the service must not fabricate success."""
    if os.getenv("DATABASE_URL"):
        return  # a real database is configured in this environment
    response = client.get("/train/00000000-0000-0000-0000-000000000000")
    assert response.status_code == 503


# ── v2 feature set + counterfactuals ────────────────────────────────────────

from app.preprocessing import DataPreprocessor, FEATURE_ORDER_V1, FEATURE_ORDER_V2
from app.main import build_counterfactuals


def test_extract_features_returns_ten_features():
    f = DataPreprocessor.extract_features(
        "Ada promo hari ini? Yuk order 🎉🎉 #promo", "Reels", 19, is_weekend=True
    )
    assert set(f.keys()) == set(FEATURE_ORDER_V2)
    assert f["is_weekend"] == 1.0
    assert f["has_question"] == 1.0
    assert f["emoji_count"] == 2.0
    # Legacy 3-arg call keeps working and defaults the weekend flag off.
    legacy = DataPreprocessor.extract_features("plain caption", "Carousel", 9)
    assert legacy["is_weekend"] == 0.0


def test_features_to_list_respects_bundle_order():
    f = DataPreprocessor.extract_features("hi #a #b", "Carousel", 12, is_weekend=True)
    v1 = DataPreprocessor.features_to_list(f, FEATURE_ORDER_V1)
    assert len(v1) == 7  # old artifacts get exactly their trained layout
    v2 = DataPreprocessor.features_to_list(f, FEATURE_ORDER_V2)
    assert len(v2) == 10
    shuffled = ["has_cta", "post_hour", "is_reels"]
    assert DataPreprocessor.features_to_list(f, shuffled) == [
        f["has_cta"], f["post_hour"], f["is_reels"]
    ]


def test_feature_ranges_use_train_split_numeric_columns_only():
    import pandas as pd
    X_train = pd.DataFrame({
        "post_hour": [8.0, 19.0, 12.0],
        "caption_length": [10.0, 120.0, 45.0],
        "hashtag_count": [0.0, 5.0, 2.0],
        "has_cta": [0.0, 1.0, 0.0],
    })
    assert DataPreprocessor.compute_feature_ranges(X_train) == {
        "post_hour": [8.0, 19.0],
        "caption_length": [10.0, 120.0],
        "hashtag_count": [0.0, 5.0],
    }


def test_out_of_range_detection_and_old_bundle_skip():
    features = {"post_hour": 22.0, "caption_length": 80.0, "hashtag_count": 2.0}
    ranges = {
        "post_hour": [8.0, 19.0],
        "caption_length": [10.0, 120.0],
        "hashtag_count": [0.0, 5.0],
    }
    assert DataPreprocessor.out_of_range_features(features, ranges) == ["post_hour"]
    assert DataPreprocessor.out_of_range_features(features, None) == []
    assert DataPreprocessor.out_of_range_features(features, {}) == []


def test_process_dataframe_weekend_across_wib_boundary():
    import pandas as pd
    df = pd.DataFrame([
        # Friday 20:00 UTC = Saturday 03:00 WIB -> weekend
        {"caption": "a", "is_single_image": True, "is_carousel": False, "is_reels": False,
         "post_hour": 3, "created_at": "2026-07-03T20:00:00+00:00"},
        # Monday 08:00 UTC = Monday 15:00 WIB -> weekday
        {"caption": "b", "is_single_image": True, "is_carousel": False, "is_reels": False,
         "post_hour": 15, "created_at": "2026-07-06T08:00:00+00:00"},
    ])
    X, cols = DataPreprocessor.process_dataframe(df)
    assert cols == FEATURE_ORDER_V2
    assert list(X["is_weekend"]) == [1.0, 0.0]


def _tiny_model(classes=("HIGH", "AVERAGE", "LOW"), n_features=10):
    import numpy as np
    from sklearn.ensemble import RandomForestClassifier
    rng = np.random.RandomState(0)
    X = rng.rand(60, n_features)
    y = [classes[i % len(classes)] for i in range(60)]
    m = RandomForestClassifier(n_estimators=10, max_depth=3, random_state=0)
    m.fit(X, y)
    return m


def test_build_counterfactuals_measured_and_honest():
    model = _tiny_model()
    base = DataPreprocessor.extract_features("short", "Reels", 9, is_weekend=False)
    base_snapshot = dict(base)
    vec = [DataPreprocessor.features_to_list(base, FEATURE_ORDER_V2)]
    probs = model.predict_proba(vec)[0]
    cfs, note = build_counterfactuals(model, base, FEATURE_ORDER_V2, model.classes_, probs)
    assert note is None and len(cfs) > 0
    assert base == base_snapshot  # input must not be mutated
    deltas = [c["delta_high"] for c in cfs]
    assert deltas == sorted(deltas, reverse=True)
    assert sum(1 for c in cfs if c["parameter"] == "post_hour") <= 1
    format_probes = [c for c in cfs if c["parameter"] == "format"]
    assert len(format_probes) == 2
    assert len({c["to_value"] for c in format_probes}) == 2
    for c in cfs:
        assert round(c["to_prob_high"] - c["from_prob_high"], 1) == c["delta_high"]


def test_build_counterfactuals_respects_v1_order_and_missing_high():
    # v1-order model must not receive an is_weekend probe
    model7 = _tiny_model(n_features=7)
    base = DataPreprocessor.extract_features("short", "Reels", 9)
    vec = [DataPreprocessor.features_to_list(base, FEATURE_ORDER_V1)]
    probs = model7.predict_proba(vec)[0]
    cfs, note = build_counterfactuals(model7, base, FEATURE_ORDER_V1, model7.classes_, probs)
    assert note is None
    assert all(c["parameter"] != "is_weekend" for c in cfs)

    # A model whose classes lack HIGH yields an honest empty result
    model2 = _tiny_model(classes=("AVERAGE", "LOW"), n_features=10)
    vec10 = [DataPreprocessor.features_to_list(base, FEATURE_ORDER_V2)]
    probs2 = model2.predict_proba(vec10)[0]
    cfs2, note2 = build_counterfactuals(model2, base, FEATURE_ORDER_V2, model2.classes_, probs2)
    assert cfs2 == [] and note2 is not None
