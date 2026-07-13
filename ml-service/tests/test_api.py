import json
import os
import sys
import datetime
import logging
from pathlib import Path
import httpx
import pytest
from fastapi.testclient import TestClient

# Adjust path to import app correctly
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.main import app
from app import instagram as instagram_module
from app import patterns as patterns_module
from app.model_loader import ModelLoader, ModelUnavailableError
from app.preprocessing import CTA_PATTERN
from app.brand_patterns import build_brand_patterns

client = TestClient(app)

# The ML service enforces a shared internal token when INTERNAL_API_TOKEN is set
# (as it is via ml-service/.env). Send it on every request, mirroring the BFF.
_token = os.getenv("INTERNAL_API_TOKEN")
if _token:
    client.headers.update({"X-Internal-Token": _token})


def test_main_composes_focused_routers_without_changing_api_paths():
    from app import predict as predict_module
    from app import train as train_module

    expected_modules = {
        ("POST", "/predict"): "app.predict",
        ("POST", "/train"): "app.train",
        ("GET", "/train/{job_id}"): "app.train",
        ("GET", "/instagram/health"): "app.instagram",
        ("GET", "/instagram/posts"): "app.instagram",
        ("POST", "/instagram/post-insights"): "app.instagram",
        ("POST", "/sync/now"): "app.instagram",
        ("GET", "/brand/patterns"): "app.patterns",
    }
    actual = {}
    routers = (
        predict_module.router,
        train_module.router,
        instagram_module.router,
        patterns_module.router,
    )
    for route in (route for router in routers for route in router.routes):
        for method in route.methods:
            actual[(method, route.path)] = route.endpoint.__module__

    assert actual == expected_modules
    openapi_operations = {
        (method.upper(), path)
        for path, operations in app.openapi()["paths"].items()
        for method in operations
    }
    assert openapi_operations == set(expected_modules)


def test_main_keeps_legacy_helper_imports_as_compatibility_reexports():
    import app.main as main_module

    assert main_module.build_counterfactuals.__module__ == "app.predict"
    assert main_module.run_training_job_async.__module__ == "app.train"
    assert main_module._fetch_ig_posts.__module__ == "app.graph_client"
    assert main_module._sync_and_retrain_pipeline.__module__ == "app.instagram"
    assert main_module.brand_patterns.__module__ == "app.patterns"


def test_predict_requires_internal_token_when_configured():
    """When a token is configured, unauthenticated requests are rejected."""
    assert _token, "CI and local test runs must configure INTERNAL_API_TOKEN"
    resp = TestClient(app).post("/predict", json={
        "caption": "hi", "format": "Reels", "post_hour": 19,
        "scheduled_date": "2026-07-11",
    })
    assert resp.status_code == 401


def test_predict_rejects_invalid_internal_token():
    resp = TestClient(app, headers={"X-Internal-Token": "wrong-token"}).post(
        "/predict",
        json={
            "caption": "hi", "format": "Reels", "post_hour": 19,
            "scheduled_date": "2026-07-11",
        },
    )
    assert resp.status_code == 401

def test_predict_endpoint_no_model_is_honest(monkeypatch):
    """
    Without a configured database / trained model, the service must return an
    honest 503 (no fabricated fallback prediction).
    """
    # Tests must never read a developer's attached/shared database.
    monkeypatch.delenv("DATABASE_URL", raising=False)
    payload = {
        "caption": "Get our exclusive discount of 20% now! Order today by visiting our bio links. #promo #discount #shopping",
        "format": "Carousel",
        "post_hour": 19,
        "brand_id": "bfd6dbca-613d-4950-8b1e-45ad7dcf1088",
        "created_by": "15663b0a-d1fc-4cb9-bac2-bb0251307441",
        "niche": "Fashion",
        "scheduled_date": "2026-07-11",
      }
    response = client.post("/predict", json=payload)
    assert response.status_code == 503
    assert "detail" in response.json()


def test_predict_rejects_impossible_schedule_before_inference():
    response = client.post("/predict", json={
        "caption": "A real draft",
        "format": "Carousel",
        "post_hour": 10,
        "scheduled_date": "2026-02-31",
        "brand_id": "bfd6dbca-613d-4950-8b1e-45ad7dcf1088",
        "created_by": "15663b0a-d1fc-4cb9-bac2-bb0251307441",
        "niche": "Fashion",
    })
    assert response.status_code == 400


@pytest.mark.parametrize("payload_update", [
    {"caption": "   "},
    {"caption": "x" * 2201},
    {"format": "Story"},
    {"post_hour": -1},
    {"post_hour": 24},
    {"post_hour": "19"},
    {"unexpected": "field"},
])
def test_predict_rejects_invalid_payloads_before_inference(payload_update):
    payload = {
        "caption": "A real draft", "format": "Reels", "post_hour": 19,
        "scheduled_date": "2026-07-11",
    }
    payload.update(payload_update)
    response = client.post("/predict", json=payload)
    assert response.status_code == 422


def test_prediction_errors_do_not_leak_internal_exception_details(monkeypatch):
    secret_detail = "postgresql://operator:secret@internal-db/predict"

    def fail_to_load(*_args, **_kwargs):
        raise RuntimeError(secret_detail)

    monkeypatch.setattr(ModelLoader, "load_model", fail_to_load)
    response = client.post("/predict", json={
        "caption": "A real draft",
        "format": "Reels",
        "post_hour": 19,
        "scheduled_date": "2026-07-11",
    })
    assert response.status_code == 500
    assert secret_detail not in response.text
    assert response.json()["detail"] == (
        "Prediction could not be completed due to an internal service error."
    )


def test_predict_requires_a_real_schedule_date():
    response = client.post("/predict", json={
        "caption": "A real draft",
        "format": "Reels",
        "post_hour": None,
    })
    assert response.status_code == 422

def test_train_endpoint_without_db_refuses_untrackable_job(monkeypatch):
    """A job that cannot be persisted must never be reported as queued."""
    monkeypatch.delenv("DATABASE_URL", raising=False)
    payload = {
        "brand_id": "bfd6dbca-613d-4950-8b1e-45ad7dcf1088",
        "niche": "Fashion"
    }
    response = client.post("/train", json=payload)
    assert response.status_code == 503


@pytest.mark.parametrize("payload", [
    {},
    {"brand_id": "not-a-uuid"},
    {"niche": "   "},
    {"niche": "Fitness", "unexpected": True},
])
def test_train_rejects_invalid_or_ambiguous_scope_before_database_io(payload):
    response = client.post("/train", json=payload)
    assert response.status_code == 422

def test_train_status_without_db_is_honest(monkeypatch):
    """Without a database there is no job state — the service must not fabricate success."""
    monkeypatch.delenv("DATABASE_URL", raising=False)
    response = client.get("/train/00000000-0000-0000-0000-000000000000")
    assert response.status_code == 503


def test_train_uses_persisted_brand_niche_for_background_scope(monkeypatch):
    import importlib

    main_module = importlib.import_module("app.main")
    queries = []

    class Cursor:
        rowcount = 0

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            pass

        def execute(self, query, params):
            queries.append((query, params))

        @staticmethod
        def fetchone():
            return ("Fitness",)

    class Connection:
        @staticmethod
        def cursor():
            return Cursor()

        @staticmethod
        def commit():
            pass

        @staticmethod
        def close():
            pass

    class Tasks:
        call = None

        def add_task(self, function, *args):
            self.call = (function, args)

    tasks = Tasks()
    brand_id = "bfd6dbca-613d-4950-8b1e-45ad7dcf1088"
    monkeypatch.setenv("DATABASE_URL", "postgresql://unused")
    monkeypatch.setattr(main_module.psycopg2, "connect", lambda *_args: Connection())

    result = main_module.train(
        main_module.TrainRequest(brand_id=brand_id, niche="Wrong caller niche"),
        tasks,
    )

    assert result["status"] == "pending"
    assert tasks.call[1][1:] == (brand_id, "Fitness")
    assert "owner_id IS NOT NULL" in queries[0][0]


# ── v2 feature set + counterfactuals ────────────────────────────────────────

from app.preprocessing import DataPreprocessor, FEATURE_ORDER_V1, FEATURE_ORDER_V2
from app.train_pipeline import (
    InsufficientDataError,
    MIN_POST_AGE_DAYS,
    ModelQualityError,
    ModelTrainer,
    build_expanding_window_evidence,
    build_model_version,
    build_classification_evidence,
    build_dataset_evidence,
)
from app.thesis_evidence import (
    configured_brand_ids,
    effective_models_for_brands,
    format_markdown,
    latest_per_scope,
)
from app.main import (
    build_counterfactuals,
    DEFAULT_INSTAGRAM_SYNC_POST_LIMIT,
    InstagramIdentityBindingError,
    _bind_instagram_identity,
    _fail_stale_retrain_jobs,
    _fetch_ig_posts,
    _get_brands_config,
    _instagram_sync_post_limit,
    _media_insight_value,
    _media_insight_values,
    _parse_instagram_health_brand_ids,
    _reconcile_prediction_publications,
    _sync_and_retrain_pipeline,
    _upsert_instagram_media,
    run_training_job_async,
)


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


def test_cta_feature_contract_keeps_ui_apply_copy_model_compatible():
    # "Save" is intentionally not treated as a CTA by existing trained
    # bundles. The Apply loop appends "Share", which the model does recognize.
    assert CTA_PATTERN.search("Save this for later") is None
    assert CTA_PATTERN.search("Share this with someone who needs it") is not None
    assert DataPreprocessor.extract_features("Save this", "Reels", 19)["has_cta"] == 0.0
    assert DataPreprocessor.extract_features("Please share this", "Reels", 19)["has_cta"] == 1.0


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


def test_sync_training_and_inference_share_one_feature_contract():
    """Golden evidence that one real post produces the same model vector."""
    import pandas as pd

    caption = "Promo akhir pekan? Yuk order 🎉 #hemat"
    inference = DataPreprocessor.extract_features(
        caption, "Carousel", 3, is_weekend=True
    )
    # Friday 20:00 UTC is Saturday 03:00 WIB, matching sync semantics.
    stored = pd.DataFrame([{
        "caption": caption,
        "is_single_image": bool(inference["is_single_image"]),
        "is_carousel": bool(inference["is_carousel"]),
        "is_reels": bool(inference["is_reels"]),
        "post_hour": inference["post_hour"],
        "caption_length": inference["caption_length"],
        "hashtag_count": inference["hashtag_count"],
        "has_cta": bool(inference["has_cta"]),
        "created_at": "2026-07-03T20:00:00+00:00",
    }])
    training, order = DataPreprocessor.process_dataframe(stored)

    assert order == FEATURE_ORDER_V2
    assert training.iloc[0].to_dict() == inference
    assert DataPreprocessor.features_to_list(
        training.iloc[0].to_dict(), order
    ) == DataPreprocessor.features_to_list(inference, order)


def test_classification_evidence_has_fixed_confusion_matrix_and_per_class_metrics():
    evidence = build_classification_evidence(
        ["LOW", "AVERAGE", "HIGH", "HIGH"],
        ["LOW", "LOW", "HIGH", "AVERAGE"],
    )

    assert evidence["confusion_matrix"] == {
        "labels": ["LOW", "AVERAGE", "HIGH"],
        "matrix": [[1, 0, 0], [1, 0, 0], [0, 1, 1]],
    }
    assert evidence["per_class"]["HIGH"]["support"] == 2
    assert evidence["accuracy"] == 0.5
    assert evidence["balanced_accuracy"] == 0.5
    assert evidence["ordinal_mae"] == 0.5
    assert evidence["quadratic_weighted_kappa"] is not None
    assert set(evidence) == {
        "accuracy",
        "balanced_accuracy",
        "ordinal_mae",
        "quadratic_weighted_kappa",
        "weighted",
        "macro",
        "per_class",
        "confusion_matrix",
    }


def test_expanding_window_evidence_recomputes_thresholds_without_holdout_leakage():
    import pandas as pd

    # Every chronological window contains the same learnable three-tier pattern.
    rows = 48
    y_er = pd.Series([float((index % 3) + 1) for index in range(rows)])
    X = pd.DataFrame({
        "is_single_image": [1.0 if index % 3 == 0 else 0.0 for index in range(rows)],
        "is_carousel": [1.0 if index % 3 == 1 else 0.0 for index in range(rows)],
        "is_reels": [1.0 if index % 3 == 2 else 0.0 for index in range(rows)],
        "post_hour": [float(index % 24) for index in range(rows)],
    })

    evidence = build_expanding_window_evidence(X, y_er)

    assert evidence["method"] == "expanding_window_on_training_portion"
    assert evidence["threshold_policy"] == (
        "recomputed_from_each_fold_training_window"
    )
    assert evidence["summary"]["evaluated_folds"] == 3
    assert evidence["summary"]["sufficient_evidence"] is True
    for fold in evidence["folds"]:
        assert fold["status"] == "evaluated"
        expected_p33, expected_p67 = DataPreprocessor.calculate_percentile_bounds(
            y_er.iloc[:fold["train_samples"]]
        )
        assert fold["p33_threshold"] == expected_p33
        assert fold["p67_threshold"] == expected_p67
        assert "logistic_regression" in fold
        assert "balanced_accuracy" in fold["candidate"]


def test_expanding_window_evidence_marks_small_history_insufficient_without_crashing():
    import pandas as pd

    y_er = pd.Series([float((index % 3) + 1) for index in range(15)])
    X = pd.DataFrame({
        "feature": [float(index % 3) for index in range(15)],
    })

    evidence = build_expanding_window_evidence(X, y_er)

    assert evidence["summary"]["evaluated_folds"] < 2
    assert evidence["summary"]["sufficient_evidence"] is False
    assert evidence["summary"]["status"] == "insufficient_history"


def test_dataset_evidence_is_deterministic_private_and_change_sensitive():
    import pandas as pd

    source = pd.DataFrame([{
        "brand_id": "brand-1",
        "instagram_media_id": "media-1",
        "caption": "Private caption should not enter evidence",
        "er": 2.5,
        "is_single_image": False,
        "is_carousel": False,
        "is_reels": True,
        "post_hour": 19,
        "created_at": "2026-07-01T12:00:00+00:00",
    }])
    features, order = DataPreprocessor.process_dataframe(source)
    first = build_dataset_evidence(source, features, order)
    repeated = build_dataset_evidence(source.copy(), features.copy(), order)

    assert first == repeated
    assert first["verified_posts"] == 1
    assert first["unique_media_ids"] == 1
    assert "Private caption" not in json.dumps(first)

    changed = source.copy()
    changed.loc[0, "er"] = 2.6
    changed_evidence = build_dataset_evidence(changed, features, order)
    assert changed_evidence["dataset_sha256"] != first["dataset_sha256"]


def test_training_versions_are_collision_resistant_and_sortable():
    versions = [build_model_version() for _ in range(100)]

    assert len(set(versions)) == len(versions)
    assert all(len(version) == 29 and version[20] == "_" for version in versions)


def test_training_persists_complete_thesis_evaluation_artifact(monkeypatch, tmp_path):
    import pandas as pd

    base_time = datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc)
    rows = []
    for index in range(60):
        format_index = index % 3
        caption = f"Promo ke-{index}? Yuk order #promo" + (" 🎉" if index % 2 else "")
        rows.append({
            "brand_id": "brand-1",
            "instagram_media_id": f"media-{index:03d}",
            "caption": caption,
            # A stable, learnable three-tier pattern appears in every temporal
            # fold and in the untouched newest 20% holdout.
            "er": float(format_index + 1),
            "is_single_image": format_index == 0,
            "is_carousel": format_index == 1,
            "is_reels": format_index == 2,
            "post_hour": index % 24,
            "created_at": base_time + datetime.timedelta(days=index),
        })
    dataset = pd.DataFrame(rows)

    class Cursor:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            pass

        @staticmethod
        def execute(*_args, **_kwargs):
            pass

        @staticmethod
        def fetchone():
            return ("model-id",)

    class Connection:
        @staticmethod
        def cursor(*_args, **_kwargs):
            return Cursor()

        @staticmethod
        def commit():
            pass

        @staticmethod
        def close():
            pass

    monkeypatch.setattr("app.train_pipeline.CACHE_DIR", str(tmp_path))
    monkeypatch.setattr(
        ModelTrainer,
        "fetch_historical_data",
        classmethod(lambda cls, brand_id=None, niche=None: dataset.copy()),
    )
    monkeypatch.setattr(
        ModelTrainer,
        "upload_to_supabase_storage",
        classmethod(lambda cls, file_path, storage_path: f"https://storage.invalid/{storage_path}"),
    )
    monkeypatch.setattr(
        ModelTrainer,
        "_get_db_connection",
        staticmethod(lambda: Connection()),
    )

    result = ModelTrainer.run_training(niche="Thesis Test")
    metrics = result["metrics"]

    assert result["status"] == "success"
    assert metrics["evaluation_contract"] == "faiv-thesis-v2"
    assert metrics["baseline"]["model"] == "DummyClassifier"
    assert metrics["comparators"]["logistic_regression"]["model"] == (
        "LogisticRegression"
    )
    assert metrics["candidate"]["confusion_matrix"]["labels"] == [
        "LOW", "AVERAGE", "HIGH"
    ]
    assert "balanced_accuracy" in metrics["candidate"]
    assert "ordinal_mae" in metrics["candidate"]
    assert "quadratic_weighted_kappa" in metrics["candidate"]
    assert metrics["temporal_evaluation"]["summary"]["evaluated_folds"] == 3
    assert metrics["holdout_permutation_importance"]["available"] is True
    assert len(metrics["holdout_permutation_importance"]["features"]) == 10
    assert metrics["feature_reference_values"]["hashtag_count_median"] == 1.0
    assert metrics["feature_reference_values"]["caption_length_median"] > 0
    assert metrics["promotion_gate"]["passed"] is True
    assert metrics["scientific_gate"]["passed"] is True
    assert metrics["evaluation_status"] == "validated"
    assert len(metrics["dataset"]["dataset_sha256"]) == 64
    assert len(metrics["training_code_sha256"]) == 64
    assert metrics["dataset"]["verified_posts"] == 60
    assert metrics["minimum_post_age_days"] == 7
    assert metrics["engagement_observation_policy"] == (
        "cumulative_at_latest_sync_after_maturity_gate"
    )
    report_path = tmp_path / result["evaluation_filename"]
    assert report_path.exists()
    persisted = json.loads(report_path.read_text(encoding="utf-8"))
    assert persisted["dataset"] == metrics["dataset"]
    assert persisted["model_parameters"]["random_state"] == 42


def test_training_keeps_useful_model_operational_but_marks_weak_holdout_exploratory(
    monkeypatch, tmp_path
):
    import pandas as pd

    base_time = datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc)
    rows = []
    for index in range(60):
        # The older 80% contains all classes. The latest 20% intentionally has
        # only HIGH posts, so operational accuracy can be useful while the
        # three-tier scientific claim remains incomplete.
        format_index = index % 3 if index < 48 else 2
        rows.append({
            "brand_id": "brand-1",
            "instagram_media_id": f"exploratory-{index:03d}",
            "caption": f"Caption {format_index}",
            "er": float(format_index + 1),
            "is_single_image": format_index == 0,
            "is_carousel": format_index == 1,
            "is_reels": format_index == 2,
            "post_hour": 10 + format_index,
            "created_at": base_time + datetime.timedelta(days=index),
        })
    dataset = pd.DataFrame(rows)

    class Cursor:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            pass

        @staticmethod
        def execute(*_args, **_kwargs):
            pass

        @staticmethod
        def fetchone():
            return ("model-id",)

    class Connection:
        @staticmethod
        def cursor(*_args, **_kwargs):
            return Cursor()

        @staticmethod
        def commit():
            pass

        @staticmethod
        def close():
            pass

    monkeypatch.setattr("app.train_pipeline.CACHE_DIR", str(tmp_path))
    monkeypatch.setattr(
        ModelTrainer,
        "fetch_historical_data",
        classmethod(lambda cls, brand_id=None, niche=None: dataset.copy()),
    )
    monkeypatch.setattr(
        ModelTrainer,
        "upload_to_supabase_storage",
        classmethod(
            lambda cls, file_path, storage_path: (
                f"https://storage.invalid/{storage_path}"
            )
        ),
    )
    monkeypatch.setattr(
        ModelTrainer,
        "_get_db_connection",
        staticmethod(lambda: Connection()),
    )

    result = ModelTrainer.run_training(niche="Exploratory Test")
    metrics = result["metrics"]

    assert metrics["promotion_gate"]["passed"] is True
    assert metrics["promotion_gate"]["decision"] == "promote"
    assert metrics["scientific_gate"]["passed"] is False
    assert metrics["evaluation_status"] == "exploratory"
    assert metrics["scientific_gate"]["missing_held_out_classes"] == [
        "AVERAGE", "LOW"
    ]
    assert (
        metrics["scientific_gate"]["hard_criteria"][
            "all_held_out_classes_present"
        ]
        is False
    )


def test_training_rejects_candidate_that_does_not_beat_baseline(monkeypatch, tmp_path):
    import pandas as pd

    rows = []
    for index in range(60):
        rows.append({
            "brand_id": "brand-1",
            "instagram_media_id": f"constant-{index:03d}",
            "caption": "same",
            "er": 0.0 if index < 5 else (1.0 if index < 43 else 2.0),
            "is_single_image": True,
            "is_carousel": False,
            "is_reels": False,
            "post_hour": 10,
            "created_at": "2026-01-05T03:00:00+00:00",
        })
    dataset = pd.DataFrame(rows)

    monkeypatch.setattr("app.train_pipeline.CACHE_DIR", str(tmp_path))
    monkeypatch.setattr(
        ModelTrainer,
        "fetch_historical_data",
        classmethod(lambda cls, brand_id=None, niche=None: dataset.copy()),
    )
    monkeypatch.setattr(
        ModelTrainer,
        "upload_to_supabase_storage",
        classmethod(lambda cls, *_args: pytest.fail("rejected candidate was uploaded")),
    )

    with pytest.raises(ModelQualityError, match="previous model remains active"):
        ModelTrainer.run_training(niche="Rejected Candidate")

    reports = list(tmp_path.glob("*.evaluation.json"))
    assert len(reports) == 1
    evidence = json.loads(reports[0].read_text(encoding="utf-8"))
    assert evidence["promotion_gate"]["passed"] is False
    assert evidence["promotion_gate"]["decision"] == "reject_keep_previous"
    assert not list(tmp_path.glob("*.joblib"))


def test_training_rejects_missing_three_tier_class(monkeypatch):
    import pandas as pd

    dataset = pd.DataFrame([{
        "brand_id": "brand-1",
        "instagram_media_id": f"tied-{index:03d}",
        "caption": "same",
        "er": 1.0 if index % 2 else 2.0,
        "is_single_image": True,
        "is_carousel": False,
        "is_reels": False,
        "post_hour": 10,
        "created_at": datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc)
        + datetime.timedelta(days=index),
    } for index in range(60)])
    monkeypatch.setattr(
        ModelTrainer,
        "fetch_historical_data",
        classmethod(lambda cls, brand_id=None, niche=None: dataset.copy()),
    )

    with pytest.raises(InsufficientDataError, match="three-tier model"):
        ModelTrainer.run_training(niche="Tied Labels")


def test_rejected_evaluation_cache_is_bounded_without_deleting_promoted_evidence(
    monkeypatch, tmp_path
):
    monkeypatch.setattr("app.train_pipeline.CACHE_DIR", str(tmp_path))
    prefix = "model_niche_Fitness_"
    for index in range(7):
        (tmp_path / f"{prefix}{index}.evaluation.json").write_text(
            "{}", encoding="utf-8"
        )
    promoted_evidence = tmp_path / f"{prefix}promoted.evaluation.json"
    promoted_evidence.write_text("{}", encoding="utf-8")
    (tmp_path / f"{prefix}promoted.joblib").write_bytes(b"model")

    ModelTrainer._cleanup_rejected_evaluations("niche", "Fitness", keep_limit=5)

    rejected = [
        path for path in tmp_path.glob(f"{prefix}*.evaluation.json")
        if path != promoted_evidence
    ]
    assert len(rejected) == 5
    assert promoted_evidence.exists()


def test_thesis_evidence_export_selects_latest_scope_and_omits_secrets():
    metrics = {
        "accuracy": 0.75,
        "candidate": {"accuracy": 0.75, "macro": {"f1_score": 0.7}},
        "baseline": {"accuracy": 0.4},
        "accuracy_gain_over_baseline": 0.35,
        "train_samples": 48,
        "test_samples": 12,
        "dataset": {"dataset_sha256": "a" * 64, "verified_posts": 60},
        "training_code_sha256": "b" * 64,
        "evaluation_contract": "faiv-thesis-v1",
    }
    rows = [
        {"brand_id": "brand-1", "brand_name": "Bison Gym", "version": "2", "model_type": "account", "metrics": metrics},
        {"brand_id": "brand-1", "brand_name": "Bison Gym", "version": "1", "model_type": "account", "metrics": metrics},
    ]

    latest = latest_per_scope(rows)
    rendered = format_markdown(latest)
    assert len(latest) == 1
    assert "Bison Gym" in rendered
    assert "faiv-thesis-v1" in rendered
    assert "DATABASE_URL" not in rendered
    assert "access_token" not in rendered


def test_thesis_evidence_leads_with_class_aware_metrics_and_compact_appendix():
    metrics = {
        "accuracy": 0.6,
        "candidate": {
            "accuracy": 0.6,
            "balanced_accuracy": 0.55,
            "quadratic_weighted_kappa": 0.4,
            "ordinal_mae": 0.45,
            "macro": {"f1_score": 0.5},
            "confusion_matrix": {
                "labels": ["LOW", "AVERAGE", "HIGH"],
                "matrix": [[3, 1, 0], [1, 2, 1], [0, 1, 3]],
            },
        },
        "baseline": {"accuracy": 0.4},
        "comparators": {"logistic_regression": {"accuracy": 0.5}},
        "accuracy_gain_over_baseline": 0.2,
        "p33_threshold": 1.25,
        "p67_threshold": 2.75,
        "train_samples": 48,
        "test_samples": 12,
        "dataset": {
            "dataset_sha256": "a" * 64,
            "first_post_at": "2025-01-01T00:00:00+00:00",
            "last_post_at": "2026-01-01T00:00:00+00:00",
        },
        "training_code_sha256": "b" * 64,
        "promotion_gate": {"passed": True, "decision": "promote"},
        "scientific_gate": {"passed": True, "decision": "validated_for_thesis_claim"},
        "evaluation_status": "validated",
        "holdout_permutation_importance": {
            "available": True,
            "features": [{"feature": "is_reels", "mean": 0.12, "std": 0.02}],
        },
    }
    rendered = format_markdown([{
        "brand_id": "brand-1",
        "brand_name": "Auditable brand",
        "version": "v1",
        "model_type": "account",
        "metrics": metrics,
    }])

    summary_header = next(line for line in rendered.splitlines() if line.startswith("| Scope |"))
    assert summary_header.index("Balanced accuracy") < summary_header.index("Accuracy")
    assert summary_header.index("Macro F1") < summary_header.index("Accuracy")
    assert summary_header.index("QWK") < summary_header.index("Accuracy")
    assert "## Compact per-scope appendix" in rendered
    assert "#### Holdout confusion matrix" in rendered
    assert "| LOW | 3 | 1 | 0 |" in rendered
    assert "#### Top holdout permutation importances" in rendered
    assert "`is_reels`" in rendered
    assert "Raw accuracy is retained for completeness" in rendered


def test_thesis_evidence_scope_uses_only_valid_explicit_and_configured_brands(monkeypatch):
    first = "7c8316af-6692-481d-b6f7-2e5483afa5e1"
    second = "d2850e10-2788-4833-be1b-cbbb782b68e9"
    monkeypatch.setenv(
        "IG_BRANDS_JSON",
        json.dumps([
            {"brand_id": first, "access_token": "must-not-be-returned"},
            {"brand_id": "invalid"},
        ]),
    )

    assert configured_brand_ids([second, first, "also-invalid"]) == [second, first]


def test_thesis_evidence_uses_served_account_model_instead_of_legacy_cohort():
    served_metrics = {
        "data_source": "instagram_graph",
        "identity_key": "instagram_media_id",
        "evaluation_contract": "faiv-thesis-v2",
        "promotion_gate": {"passed": True},
    }
    rows = [
        {"id": "account-new", "brand_id": "brand-1", "model_type": "account", "niche": None, "metrics": served_metrics},
        {"id": "cohort-old", "brand_id": None, "model_type": "niche", "niche": "Fitness", "metrics": served_metrics},
    ]
    selected = effective_models_for_brands(
        rows,
        [{"id": "brand-1", "niche": "Fitness"}],
    )

    assert [row["id"] for row in selected] == ["account-new"]


def test_thesis_evidence_excludes_models_that_serving_would_reject():
    served_metrics = {
        "data_source": "instagram_graph",
        "identity_key": "instagram_media_id",
        "evaluation_contract": "faiv-thesis-v2",
        "promotion_gate": {"passed": True},
    }
    rejected_metrics = {**served_metrics, "promotion_gate": {"passed": False}}
    selected = effective_models_for_brands(
        [
            {
                "id": "rejected-account",
                "brand_id": "brand-1",
                "model_type": "account",
                "niche": None,
                "metrics": rejected_metrics,
            },
            {
                "id": "served-cohort",
                "brand_id": None,
                "model_type": "niche",
                "niche": "Fitness",
                "metrics": served_metrics,
            },
        ],
        [{"id": "brand-1", "niche": "Fitness"}],
    )

    assert [row["id"] for row in selected] == ["served-cohort"]


def _tiny_model(classes=("HIGH", "AVERAGE", "LOW"), n_features=10):
    import numpy as np
    from sklearn.ensemble import RandomForestClassifier
    rng = np.random.RandomState(0)
    X = rng.rand(60, n_features)
    y = [classes[i % len(classes)] for i in range(60)]
    m = RandomForestClassifier(n_estimators=10, max_depth=3, random_state=0)
    m.fit(X, y)
    return m


def test_predict_success_contract_uses_real_bundle_outputs(monkeypatch):
    model = _tiny_model()
    bundle = {
        "model": model,
        "features": FEATURE_ORDER_V2,
        "feature_ranges": {
            "post_hour": [8.0, 20.0],
            "caption_length": [1.0, 20.0],
            "hashtag_count": [0.0, 5.0],
            "emoji_count": [0.0, 2.0],
        },
        "post_hour_support": {"8": 2, "20": 1},
        "feature_reference_values": {
            "caption_length_median": 120.0,
            "hashtag_count_median": 2.0,
        },
    }
    metadata = {
        "id": "model-1",
        "model_type": "niche",
        "version": "test-v1",
        "accuracy": 0.75,
        "metrics": {
            "train_samples": 42,
            "test_samples": 12,
            "candidate": {
                "macro": {"f1_score": 0.7},
                "balanced_accuracy": 0.72,
            },
            "baseline": {"accuracy": 0.4},
            "accuracy_gain_over_baseline": 0.35,
            "evaluation_status": "validated",
            "scientific_gate": {
                "passed": True,
                "hard_criteria": {"all_held_out_classes_present": True},
            },
        },
    }
    monkeypatch.setattr(ModelLoader, "load_model", lambda **_kwargs: (bundle, metadata))
    monkeypatch.delenv("DATABASE_URL", raising=False)

    response = client.post("/predict", json={
        "caption": "A deliberately longer caption asking a question? Share it #one",
        "format": "Carousel",
        "post_hour": 10,
        "scheduled_date": "2026-07-11",
    })

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "success"
    assert body["prediction_id"] is None
    assert body["model_metadata"]["trained_samples"] == 42
    assert body["model_metadata"]["is_personal_model_active"] is False
    assert body["model_metadata"]["test_samples"] == 12
    assert body["model_metadata"]["macro_f1"] == 0.7
    assert body["model_metadata"]["balanced_accuracy"] == 0.72
    assert body["model_metadata"]["baseline_accuracy"] == 0.4
    assert body["model_metadata"]["accuracy_gain_over_baseline"] == 0.35
    assert body["model_metadata"]["held_out_classes_complete"] is True
    assert body["model_metadata"]["evaluation_status"] == "validated"
    assert body["model_metadata"]["scientific_gate_passed"] is True
    assert body["prediction_context"] == {
        "status": "current",
        "time_known": True,
        "scenario_hours": [],
        "scenario_support_basis": "exact_time",
        "scenario_weights": [],
        "input_hash": body["prediction_context"]["input_hash"],
        "feature_schema_version": body["prediction_context"]["feature_schema_version"],
    }
    assert len(body["prediction_context"]["input_hash"]) == 64
    assert body["prediction_context"]["feature_schema_version"].startswith("sha256:")
    assert "caption_length" in body["out_of_range"]
    assert set(body["probabilities"]) == {name.title() for name in model.classes_}
    assert len([row for row in body["counterfactuals"] if row["parameter"] == "format"]) == 2
    hour_rows = [row for row in body["counterfactuals"] if row["parameter"] == "post_hour"]
    assert len(hour_rows) == 1
    assert hour_rows[0]["to_value"] in {8, 20}


def test_predict_without_post_time_is_explicitly_provisional(monkeypatch):
    """An optional time must never be silently replaced with a default hour."""
    model = _tiny_model()
    bundle = {
        "model": model,
        "features": FEATURE_ORDER_V2,
        "feature_ranges": {
            "post_hour": [8.0, 20.0],
            "caption_length": [1.0, 200.0],
            "hashtag_count": [0.0, 5.0],
            "emoji_count": [0.0, 2.0],
        },
        "post_hour_support": {"8": 1, "20": 3},
    }
    metadata = {
        "id": "model-optional-time",
        "model_type": "niche",
        "version": "test-v1",
        "accuracy": 0.75,
        "metrics": {"train_samples": 42},
    }
    monkeypatch.setattr(ModelLoader, "load_model", lambda **_kwargs: (bundle, metadata))
    monkeypatch.delenv("DATABASE_URL", raising=False)

    response = client.post("/predict", json={
        "caption": "A real draft with no committed publishing time #launch",
        "format": "Reels",
        "post_hour": None,
        "scheduled_date": "2026-07-11",
    })

    assert response.status_code == 200
    body = response.json()
    assert body["prediction_context"] == {
        "status": "provisional",
        "time_known": False,
        "scenario_hours": [8, 20],
        "scenario_support_basis": "empirical_training_distribution",
        "scenario_weights": [0.25, 0.75],
        "input_hash": body["prediction_context"]["input_hash"],
        "feature_schema_version": body["prediction_context"]["feature_schema_version"],
    }
    assert "frequency-weighted hours observed" in body["counterfactuals_note"]
    assert "equally" not in body["counterfactuals_note"]
    assert "post_hour" not in body["out_of_range"]
    assert len(body["counterfactuals"]) == 1
    assert body["counterfactuals"][0]["parameter"] == "post_hour"


def test_predict_rejects_incomplete_supersession_metadata():
    response = client.post("/predict", json={
        "caption": "A real draft",
        "format": "Reels",
        "post_hour": 19,
        "scheduled_date": "2026-07-11",
        "brand_id": "bfd6dbca-613d-4950-8b1e-45ad7dcf1088",
        "created_by": "15663b0a-d1fc-4cb9-bac2-bb0251307441",
        "supersedes_prediction_id": "2e4ca101-c68c-44ef-8fa8-192398c602e1",
    })
    assert response.status_code == 422


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


def test_counterfactual_candidates_use_training_artifact_support():
    model = _tiny_model()
    base = DataPreprocessor.extract_features(
        "A short caption #one",
        "Reels",
        10,
        is_weekend=False,
    )
    probs = model.predict_proba([
        DataPreprocessor.features_to_list(base, FEATURE_ORDER_V2)
    ])[0]

    cfs, _ = build_counterfactuals(
        model,
        base,
        FEATURE_ORDER_V2,
        model.classes_,
        probs,
        post_hour_support={"8": 3, "20": 1, "99": 100, "bad": 2},
        feature_reference_values={
            "caption_length_median": 137.0,
            "hashtag_count_median": 4.0,
        },
    )

    hour_rows = [row for row in cfs if row["parameter"] == "post_hour"]
    assert len(hour_rows) == 1
    assert hour_rows[0]["to_value"] in {8, 20}
    assert next(row for row in cfs if row["parameter"] == "hashtag_count")["to_value"] == 4
    assert next(row for row in cfs if row["parameter"] == "caption_length")["to_value"] == 137


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


def test_meta_insight_payload_parsing_preserves_zero_and_multiple_metrics():
    payload = {
        "data": [
            {"name": "reach", "total_value": {"value": 125}},
            {"name": "saved", "values": [{"value": 0}]},
        ]
    }
    assert _media_insight_value({"data": [payload["data"][0]]}) == 125.0
    assert _media_insight_values(payload) == {"reach": 125.0, "saved": 0.0}


@pytest.mark.parametrize(
    ("overrides", "expected_code"),
    [
        ({"has_sync": False}, "not_synced"),
        ({"er": None}, "not_synced"),
        ({"is_mature": False}, "immature"),
        ({"is_modeled_format": False}, "unmodeled_format"),
        ({"has_complete_features": False}, "incomplete_features"),
        ({}, None),
    ],
)
def test_post_comparison_status_is_explicit(overrides, expected_code):
    import importlib

    main_module = importlib.import_module("app.main")
    values = {
        "has_sync": True,
        "er": 3.5,
        "is_mature": True,
        "is_modeled_format": True,
        "has_complete_features": True,
    }
    values.update(overrides)
    status = main_module._post_comparison_status(**values)

    assert status["eligible"] is (expected_code is None)
    assert status["reason_code"] == expected_code
    assert (status["reason"] is None) is (expected_code is None)


def test_instagram_posts_uses_verified_sync_er_instead_of_current_followers(monkeypatch):
    """Live post cards must not rebase historical ER onto today's audience."""
    import importlib

    main_module = importlib.import_module("app.main")
    brand_id = "bfd6dbca-613d-4950-8b1e-45ad7dcf1088"
    synced_at = datetime.datetime(2026, 7, 10, 4, 30, tzinfo=datetime.timezone.utc)
    executed_queries = []

    monkeypatch.setenv("DATABASE_URL", "postgresql://unused")
    monkeypatch.setattr(instagram_module, "_get_instagram_connection", lambda _brand_id: {
        "brand_id": brand_id,
        "name": "Verified brand",
        "instagram_id": "17840000000000000",
        "access_token": "token",
    })
    monkeypatch.setattr(instagram_module, "_fetch_ig_profile", lambda *_args: 1000)

    class Cursor:
        def __init__(self):
            self.query = ""

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            pass

        def execute(self, query, params):
            self.query = query
            executed_queries.append((query, params))

        def fetchall(self):
            assert "p.source = 'instagram_graph'" in self.query
            assert "p.instagram_media_id IS NOT NULL" in self.query
            return [("post-111", "111", 4.2, synced_at, True, True, True)]

        def fetchone(self):
            assert "p.source = 'instagram_graph'" in self.query
            assert "p.instagram_media_id IS NOT NULL" in self.query
            return (3.0, 5.0)

    class Connection:
        @staticmethod
        def cursor(*_args, **_kwargs):
            return Cursor()

        @staticmethod
        def close():
            pass

    monkeypatch.setattr(main_module.psycopg2, "connect", lambda *_args, **_kwargs: Connection())

    class GraphResponse:
        status_code = 200

        @staticmethod
        def raise_for_status():
            pass

        @staticmethod
        def json():
            return {"data": [
                {
                    "id": "111",
                    "caption": "Synced post",
                    "like_count": 10,
                    "comments_count": 5,
                        "media_type": "IMAGE",
                        "media_product_type": "FEED",
                    "timestamp": "2026-07-09T12:00:00+0000",
                },
                {
                    "id": "222",
                    "caption": "Not synced yet",
                    "like_count": 900,
                    "comments_count": 100,
                        "media_type": "VIDEO",
                        "media_product_type": "REELS",
                    "timestamp": "2026-07-10T12:00:00+0000",
                },
            ]}

    class GraphClient:
        def __init__(self, *_args, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            pass

        @staticmethod
        def get(*_args, **_kwargs):
            return GraphResponse()

    monkeypatch.setattr(main_module.httpx, "Client", GraphClient)

    response = client.get(f"/instagram/posts?brand_id={brand_id}")
    assert response.status_code == 200
    payload = response.json()
    assert payload["posts"][0]["er"] == 4.2  # not live (10 + 5) / 1,000 = 1.5%
    assert payload["posts"][0]["post_id"] == "post-111"
    assert payload["posts"][0]["tier"] == "Average"
    assert payload["posts"][0]["comparison_eligible"] is True
    assert payload["posts"][0]["comparison_unavailable_reason"] is None
    assert payload["posts"][0]["synced_at"] == synced_at.isoformat()
    assert payload["posts"][0]["media_product_type"] == "FEED"
    assert payload["posts"][1]["er"] is None
    assert payload["posts"][1]["tier"] is None
    assert payload["posts"][1]["comparison_eligible"] is False
    assert payload["posts"][1]["comparison_unavailable_code"] == "not_synced"
    assert payload["provenance"]["live_source"] == "instagram_graph_api"
    assert payload["provenance"]["synced_source"] == "production_database_instagram_graph_sync"
    assert executed_queries[0][1] == (MIN_POST_AGE_DAYS, brand_id)
    assert executed_queries[1][1] == (brand_id, MIN_POST_AGE_DAYS)


def test_instagram_posts_falls_back_to_stored_verified_history(monkeypatch):
    import importlib

    main_module = importlib.import_module("app.main")
    brand_id = "bfd6dbca-613d-4950-8b1e-45ad7dcf1088"
    post_id = "4b3e1aa0-3926-4b8c-b212-4015b756e62c"
    created_at = datetime.datetime(2026, 6, 1, tzinfo=datetime.timezone.utc)
    synced_at = datetime.datetime(2026, 7, 10, tzinfo=datetime.timezone.utc)
    monkeypatch.setenv("DATABASE_URL", "postgresql://unused")
    monkeypatch.setattr(instagram_module, "_get_instagram_connection", lambda _brand_id: {
        "brand_id": brand_id,
        "name": "Stored brand",
        "instagram_id": "17840000000000000",
        "access_token": "secret",
    })
    monkeypatch.setattr(
        instagram_module,
        "_fetch_ig_profile",
        lambda *_args: (_ for _ in ()).throw(RuntimeError("offline")),
    )

    class Cursor:
        def __init__(self):
            self.query = ""

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            pass

        def execute(self, query, _params):
            self.query = query

        def fetchall(self):
            if "JOIN brands b" in self.query:
                return [(
                    post_id,
                    "111",
                    "Stored verified caption",
                    "FEED",
                    True,
                    False,
                    False,
                    created_at,
                    1250,
                )]
            return [(post_id, "111", 4.2, synced_at, True, True, True)]

        @staticmethod
        def fetchone():
            return (3.0, 5.0)

    class Connection:
        @staticmethod
        def cursor(*_args, **_kwargs):
            return Cursor()

        @staticmethod
        def close():
            pass

    monkeypatch.setattr(main_module.psycopg2, "connect", lambda *_args, **_kwargs: Connection())

    response = client.get(f"/instagram/posts?brand_id={brand_id}")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "degraded"
    assert payload["followers"] == 1250
    assert payload["provenance"]["live_source"] is None
    assert payload["provenance"]["stored_only"] is True
    assert payload["posts"][0]["post_id"] == post_id
    assert payload["posts"][0]["er"] == 4.2
    assert payload["posts"][0]["likes"] is None
    assert payload["posts"][0]["comments"] is None
    assert payload["posts"][0]["media_url"] is None


def test_post_detail_prediction_match_uses_meta_verified_caption(monkeypatch):
    """The caller cannot supply a caption to manufacture a prediction match."""
    import importlib

    main_module = importlib.import_module("app.main")
    brand_id = "bfd6dbca-613d-4950-8b1e-45ad7dcf1088"
    user_id = "15663b0a-d1fc-4cb9-bac2-bb0251307441"
    media_id = "17900000000000001"
    prediction_params = []
    historical_queries = []
    prediction_rows = [
        {
            "id": "4b3e1aa0-3926-4b8c-b212-4015b756e62c",
            "pred_class": "HIGH",
            "actual_er": None,
            "actual_source": None,
            "model_version": "1",
            "confidence": "80",
            "publication_linked": False,
            "publication_matches_selected_media": False,
        },
        {
            "id": "6656a7ff-dd36-456d-bf72-03b090e9fd5a",
            "pred_class": "LOW",
            "actual_er": None,
            "actual_source": None,
            "model_version": "2",
            "confidence": "70",
            "publication_linked": False,
            "publication_matches_selected_media": False,
        },
    ]

    monkeypatch.setenv("DATABASE_URL", "postgresql://unused")
    monkeypatch.setattr(instagram_module, "_get_instagram_connection", lambda _brand_id: {
        "brand_id": brand_id,
        "name": "Verified brand",
        "instagram_id": "17840000000000000",
        "access_token": "token",
    })

    class GraphResponse:
        def __init__(self, status_code, payload):
            self.status_code = status_code
            self._payload = payload

        def json(self):
            return self._payload

    class GraphClient:
        def __init__(self, *_args, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            pass

        @staticmethod
        def get(url, params):
            if url.endswith(f"/{media_id}"):
                assert params["fields"] == "id,owner,caption"
                return GraphResponse(200, {
                    "id": media_id,
                    "owner": {"id": "17840000000000000"},
                    "caption": "  Verified   Graph Caption  ",
                })
            return GraphResponse(400, {})

    monkeypatch.setattr(main_module.httpx, "Client", GraphClient)

    class Cursor:
        def __init__(self):
            self.query = ""

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            pass

        def execute(self, query, params):
            self.query = query
            if "FROM posts p" in query:
                historical_queries.append((query, params))
            if "FROM predictions" in query:
                prediction_params.append(params)

        def fetchone(self):
            if "AS is_mature" in self.query:
                return {
                    "post_id": "4b3e1aa0-3926-4b8c-b212-4015b756e62c",
                    "er": 4.0,
                    "is_mature": True,
                    "is_modeled_format": True,
                    "has_complete_features": True,
                }
            if "brand_median_er" in self.query:
                return {"brand_median_er": 3.0, "brand_baseline_posts": 12}
            return None

        def fetchall(self):
            if "FROM predictions" not in self.query:
                return []
            # Two exact-caption rows are intentionally ambiguous; the API must
            # not arbitrarily pick the newest and present it as this post.
            return list(prediction_rows)

    class Connection:
        @staticmethod
        def cursor(*_args, **_kwargs):
            return Cursor()

        @staticmethod
        def close():
            pass

    monkeypatch.setattr(main_module.psycopg2, "connect", lambda *_args, **_kwargs: Connection())

    rejected = client.post("/instagram/post-insights", json={
        "brand_id": brand_id,
        "media_id": media_id,
        "created_by": user_id,
        "caption": "Attacker supplied caption",
    })
    assert rejected.status_code == 422

    response = client.post("/instagram/post-insights", json={
        "brand_id": brand_id,
        "media_id": media_id,
        "created_by": user_id,
    })
    assert response.status_code == 200
    assert prediction_params == [(media_id, brand_id, user_id, "verified graph caption")]
    payload = response.json()
    assert payload["prediction"] is None
    assert payload["prediction_match_status"] == "ambiguous_duplicate_caption"
    assert payload["historical"]["comparison_eligible"] is True
    assert payload["historical"]["verified_post_id"] == "4b3e1aa0-3926-4b8c-b212-4015b756e62c"
    assert payload["historical"]["brand_median_er"] == 3.0
    assert payload["historical"]["brand_baseline_posts"] == 12
    assert "recent_median_er" not in payload["historical"]
    assert payload["historical"]["recent_performance"]["available"] is False
    assert payload["historical"]["recent_performance"]["reason_code"] == (
        "fixed_horizon_snapshots_unavailable"
    )
    assert len(historical_queries) == 2
    selected_query, selected_params = historical_queries[0]
    baseline_query, baseline_params = historical_queries[1]
    assert "p.instagram_media_id = %s" in selected_query
    assert selected_params == (MIN_POST_AGE_DAYS, brand_id, media_id)
    assert "p.created_at <= now()" in baseline_query
    assert "p.media_product_type = 'REELS'" in baseline_query
    assert "p.instagram_media_id <> %s" in baseline_query
    assert baseline_params == (brand_id, media_id, MIN_POST_AGE_DAYS)
    assert all("recent_median_er" not in query for query, _params in historical_queries)
    assert payload["provenance"]["live_source"] == "instagram_graph_api"

    prediction_rows[:] = [prediction_rows[0]]
    candidate_response = client.post("/instagram/post-insights", json={
        "brand_id": brand_id,
        "media_id": media_id,
        "created_by": user_id,
    })
    assert candidate_response.status_code == 200
    candidate = candidate_response.json()["prediction"]
    assert candidate_response.json()["prediction_match_status"] == "unique_verified_caption"
    assert candidate["id"] == "4b3e1aa0-3926-4b8c-b212-4015b756e62c"
    assert candidate["publication_linked"] is False
    assert candidate["publication_matches_selected_media"] is False
    assert candidate["match_method"] == "verified_graph_caption_candidate"


def test_post_detail_resolves_immutable_link_even_when_caption_is_empty(monkeypatch):
    import importlib

    main_module = importlib.import_module("app.main")
    brand_id = "bfd6dbca-613d-4950-8b1e-45ad7dcf1088"
    user_id = "15663b0a-d1fc-4cb9-bac2-bb0251307441"
    prediction_id = "4b3e1aa0-3926-4b8c-b212-4015b756e62c"
    post_id = "6656a7ff-dd36-456d-bf72-03b090e9fd5a"
    media_id = "17900000000000001"
    prediction_queries = []
    monkeypatch.setenv("DATABASE_URL", "postgresql://unused")
    monkeypatch.setattr(instagram_module, "_get_instagram_connection", lambda _brand_id: {
        "brand_id": brand_id,
        "name": "Verified brand",
        "instagram_id": "17840000000000000",
        "access_token": "token",
    })

    class GraphResponse:
        def __init__(self, status_code, payload):
            self.status_code = status_code
            self.payload = payload

        def json(self):
            return self.payload

    class GraphClient:
        def __init__(self, *_args, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            pass

        @staticmethod
        def get(url, params):
            if url.endswith(f"/{media_id}"):
                return GraphResponse(200, {
                    "id": media_id,
                    "owner": {"id": "17840000000000000"},
                    "caption": "",
                })
            return GraphResponse(400, {})

    monkeypatch.setattr(main_module.httpx, "Client", GraphClient)

    class Cursor:
        def __init__(self):
            self.query = ""

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            pass

        def execute(self, query, _params):
            self.query = query
            if "prediction_publications" in query:
                prediction_queries.append(query)

        def fetchone(self):
            if "AS is_mature" in self.query:
                return {
                    "post_id": post_id,
                    "er": 4.1,
                    "is_mature": True,
                    "is_modeled_format": True,
                    "has_complete_features": True,
                }
            if "brand_median_er" in self.query:
                return {"brand_median_er": 3.0, "brand_baseline_posts": 12}
            if "FROM prediction_publications publication" in self.query:
                return {
                    "id": prediction_id,
                    "pred_class": "HIGH",
                    "actual_er": 4.1,
                    "actual_source": "instagram_media_id",
                    "model_version": "v1",
                    "confidence": "80",
                    "publication_linked": True,
                    "publication_matches_selected_media": True,
                }
            return None

        @staticmethod
        def fetchall():
            raise AssertionError("caption fallback must not run for an immutable link")

    class Connection:
        @staticmethod
        def cursor(*_args, **_kwargs):
            return Cursor()

        @staticmethod
        def close():
            pass

    monkeypatch.setattr(main_module.psycopg2, "connect", lambda *_args, **_kwargs: Connection())

    response = client.post("/instagram/post-insights", json={
        "brand_id": brand_id,
        "media_id": media_id,
        "created_by": user_id,
    })

    assert response.status_code == 200
    payload = response.json()
    assert payload["prediction_match_status"] == "verified_publication_link"
    assert payload["prediction"]["id"] == prediction_id
    assert payload["prediction"]["match_method"] == "verified_media_id"
    assert payload["prediction"]["publication_linked"] is True
    assert payload["prediction"]["actual_er"] == 4.1
    assert payload["prediction"]["realized_tier"] is None
    assert payload["prediction"]["realized_class_basis"] is None
    assert all("actual_class" not in query for query in prediction_queries)


def test_instagram_config_requires_explicit_json(monkeypatch):
    """An absent explicit mapping must remain disconnected."""
    monkeypatch.delenv("IG_BRANDS_JSON", raising=False)
    assert _get_brands_config() == []


def test_instagram_config_validates_and_rejects_duplicate_bindings(monkeypatch):
    brand_id = "bfd6dbca-613d-4950-8b1e-45ad7dcf1088"
    monkeypatch.setenv(
        "IG_BRANDS_JSON",
        json.dumps([{"brand_id": brand_id, "instagram_id": "17840", "access_token": "token"}]),
    )
    config = _get_brands_config()
    assert config == [{"brand_id": brand_id, "instagram_id": "17840", "access_token": "token"}]

    monkeypatch.setenv("IG_BRANDS_JSON", json.dumps([
        {"brand_id": brand_id, "instagram_id": "17840", "access_token": "a"},
        {"brand_id": brand_id, "instagram_id": "17850", "access_token": "b"},
    ]))
    assert _get_brands_config() == []

    other_brand = "15663b0a-d1fc-4cb9-bac2-bb0251307441"
    monkeypatch.setenv("IG_BRANDS_JSON", json.dumps([
        {"brand_id": brand_id, "instagram_id": "17840", "access_token": "a"},
        {"brand_id": other_brand, "instagram_id": "17840", "access_token": "b"},
    ]))
    assert _get_brands_config() == []


def test_persisted_instagram_identity_mismatch_is_rejected_before_graph_io(monkeypatch):
    import importlib

    main_module = importlib.import_module("app.main")
    brand_id = "bfd6dbca-613d-4950-8b1e-45ad7dcf1088"
    monkeypatch.setenv("DATABASE_URL", "postgresql://unused")
    monkeypatch.setattr(instagram_module, "_get_brands_config", lambda: [{
        "brand_id": brand_id,
        "instagram_id": "17840000000000001",
        "access_token": "runtime-only-secret",
    }])
    queries = []

    class Cursor:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            pass

        def execute(self, query):
            queries.append(query)

        @staticmethod
        def fetchall():
            return [{
                "id": brand_id,
                "name": "Bound brand",
                "niche": "Fitness",
                "instagram_account_id": "17840000000000002",
            }]

    class Connection:
        @staticmethod
        def cursor(*_args, **_kwargs):
            return Cursor()

        @staticmethod
        def close():
            pass

    monkeypatch.setattr(main_module.psycopg2, "connect", lambda *_args, **_kwargs: Connection())

    result = main_module._bound_instagram_configs()

    assert result[0]["brand_id"] is None
    assert "persistent" in result[0]["binding_error"]
    assert all("access_token" not in query for query in queries)


def test_identity_binding_is_atomic_and_never_persists_a_token():
    class Cursor:
        def __init__(self, row):
            self.row = row
            self.query = ""
            self.params = None

        def execute(self, query, params):
            self.query = query
            self.params = params

        def fetchone(self):
            return self.row

    cursor = Cursor(("17840000000000001",))
    _bind_instagram_identity(
        cursor,
        brand_id="bfd6dbca-613d-4950-8b1e-45ad7dcf1088",
        instagram_account_id="17840000000000001",
        followers=100,
    )

    assert "COALESCE(instagram_account_id" in cursor.query
    assert "instagram_account_id = %s" in cursor.query
    assert "access_token" not in cursor.query.lower()
    assert cursor.params == (
        100,
        "17840000000000001",
        "bfd6dbca-613d-4950-8b1e-45ad7dcf1088",
        "17840000000000001",
    )

    with pytest.raises(InstagramIdentityBindingError, match="persistent binding"):
        _bind_instagram_identity(
            Cursor(None),
            brand_id="bfd6dbca-613d-4950-8b1e-45ad7dcf1088",
            instagram_account_id="17840000000000002",
            followers=100,
        )


def test_publication_reconciliation_delegates_to_guarded_database_function():
    class Cursor:
        def __init__(self):
            self.query = ""
            self.params = None

        def execute(self, query, params):
            self.query = query
            self.params = params

        @staticmethod
        def fetchone():
            return (2,)

    cursor = Cursor()
    brand_id = "bfd6dbca-613d-4950-8b1e-45ad7dcf1088"

    assert _reconcile_prediction_publications(cursor, brand_id) == 2
    assert "reconcile_prediction_publication_outcomes" in cursor.query
    assert "actual_class" not in cursor.query
    assert cursor.params == (brand_id,)


def test_publication_migration_keeps_continuous_outcome_academically_honest():
    migration = (
        Path(__file__).resolve().parents[2]
        / "supabase"
        / "migrations"
        / "202607120004_content_lifecycle_integration.sql"
    ).read_text(encoding="utf-8")

    assert "CREATE TABLE IF NOT EXISTS public.prediction_publications" in migration
    assert "CREATE OR REPLACE FUNCTION public.link_prediction_publication" in migration
    assert "reconcile_prediction_publication_outcomes" in migration
    assert "post.created_at <= now() - (7 * interval '1 day')" in migration
    assert "prediction.actual_class IS NULL" in migration
    assert "SET actual_er = eligible.er" in migration
    assert "actual_source = 'instagram_media_id'" in migration
    assert "SET actual_class = NULL" not in migration
    assert "access_token" not in migration.lower()


def test_realized_tier_migration_uses_historical_serving_model_thresholds():
    migration = (
        Path(__file__).resolve().parents[2]
        / "supabase"
        / "migrations"
        / "202607130005_realized_tier.sql"
    ).read_text(encoding="utf-8")

    assert "ADD COLUMN IF NOT EXISTS realized_class" in migration
    assert "ADD COLUMN IF NOT EXISTS realized_class_basis" in migration
    assert "LEFT JOIN public.models model ON model.id = prediction.model_id" in migration
    assert "model.metrics->'p33_threshold'" in migration
    assert "model.metrics->'p67_threshold'" in migration
    assert "WHEN er < p33 THEN 'LOW'" in migration
    assert "WHEN er <= p67 THEN 'AVERAGE'" in migration
    assert "'model_id', eligible.model_id::TEXT" in migration
    assert "'minimum_post_age_days', 7" in migration
    assert "prediction.actual_class IS NULL" in migration
    assert "previous_realized_class" in migration
    assert (
        "REVOKE ALL ON FUNCTION public.reconcile_prediction_publication_outcomes(UUID)"
        in migration
    )
    assert "ORDER BY model.created_at" not in migration
    assert "access_token" not in migration.lower()


def test_brand_trend_notes_migration_is_bounded_owner_scoped_and_not_updatable():
    migration = (
        Path(__file__).resolve().parents[2]
        / "supabase"
        / "migrations"
        / "202607130006_brand_trend_notes.sql"
    ).read_text(encoding="utf-8")

    assert "CREATE TABLE IF NOT EXISTS public.brand_trend_notes" in migration
    assert "BETWEEN 1 AND 300" in migration
    assert "BETWEEN 1 AND 200" in migration
    assert "observed_at <= CURRENT_DATE" in migration
    assert migration.count("brand.owner_id = auth.uid()") == 3
    assert "created_by = auth.uid()" in migration
    assert "GRANT SELECT, DELETE" in migration
    assert "GRANT INSERT (brand_id, note, source, observed_at, tag, created_by)" in migration
    assert "FOR UPDATE TO authenticated" not in migration
    assert "GRANT UPDATE" not in migration
    assert "access_token" not in migration.lower()


def test_stale_retrain_jobs_are_failed_before_new_work_is_queued():
    class Cursor:
        rowcount = 3

        def __init__(self):
            self.query = ""
            self.params = None

        def execute(self, query, params):
            self.query = query
            self.params = params

    cursor = Cursor()

    assert _fail_stale_retrain_jobs(cursor) == 3
    assert "status IN ('pending', 'running')" in cursor.query
    assert "status = 'failed'" in cursor.query
    assert "service restart" in cursor.query
    assert cursor.params == (30,)


def test_background_training_failure_records_terminal_timestamps(monkeypatch):
    import importlib

    main_module = importlib.import_module("app.main")
    calls = []

    class Cursor:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            pass

        def execute(self, query, params):
            calls.append((query, params))

    class Connection:
        @staticmethod
        def cursor():
            return Cursor()

        @staticmethod
        def commit():
            pass

        @staticmethod
        def close():
            pass

    def fail_training(*_args, **_kwargs):
        raise RuntimeError("failed")

    monkeypatch.setenv("DATABASE_URL", "postgresql://unused")
    monkeypatch.setattr(main_module.psycopg2, "connect", lambda *_args: Connection())
    monkeypatch.setattr(ModelTrainer, "run_training", fail_training)

    run_training_job_async("job-id", "brand-id", "Fitness")

    failure_query, failure_params = calls[-1]
    assert "status = 'failed'" in failure_query
    assert "completed_at" in failure_query and "finished_at" in failure_query
    assert failure_params[-1] == "job-id"
    assert all(value.tzinfo is not None for value in failure_params[1:3])


def test_instagram_sync_post_limit_is_configurable_and_bounded(monkeypatch):
    monkeypatch.delenv("IG_SYNC_POST_LIMIT", raising=False)
    assert _instagram_sync_post_limit() == DEFAULT_INSTAGRAM_SYNC_POST_LIMIT

    monkeypatch.setenv("IG_SYNC_POST_LIMIT", "750")
    assert _instagram_sync_post_limit() == 750

    for boundary in ("1", "1000"):
        monkeypatch.setenv("IG_SYNC_POST_LIMIT", boundary)
        assert _instagram_sync_post_limit() == int(boundary)

    for invalid in ("", " ", "not-a-number"):
        monkeypatch.setenv("IG_SYNC_POST_LIMIT", invalid)
        with pytest.raises(ValueError, match="must be an integer"):
            _instagram_sync_post_limit()

    for invalid in ("-1", "0", "1001"):
        monkeypatch.setenv("IG_SYNC_POST_LIMIT", invalid)
        with pytest.raises(ValueError, match="between 1 and 1000"):
            _instagram_sync_post_limit()


def test_instagram_media_fetch_paginates_until_configured_total(monkeypatch):
    import importlib

    main_module = importlib.import_module("app.main")
    calls = []

    class Response:
        def __init__(self, payload):
            self.payload = payload

        @staticmethod
        def raise_for_status():
            pass

        def json(self):
            return self.payload

    class Client:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def get(self, url, params):
            calls.append((url, dict(params)))
            if url.endswith("/ig-account/media"):
                if params.get("after") == "cursor-1":
                    return Response({
                        "data": [{"id": str(index)} for index in range(100, 200)],
                        "paging": {
                            "next": "https://graph.facebook.com/v25.0/ig-account/media",
                            "cursors": {"after": "cursor-2"},
                        },
                    })
                return Response({
                    "data": [{"id": str(index)} for index in range(100)],
                    "paging": {
                        # Reproduce Meta returning a next URL without query
                        # credentials; the cursor remains authoritative.
                        "next": "https://graph.facebook.com/v25.0/ig-account/media",
                        "cursors": {"after": "cursor-1"},
                    },
                })
            raise AssertionError(f"unexpected pagination URL: {url}")

    monkeypatch.setattr(main_module.httpx, "Client", Client)
    monkeypatch.setenv("IG_SYNC_POST_LIMIT", "150")

    posts, truncated = _fetch_ig_posts("ig-account", "secret")

    assert [post["id"] for post in posts] == [str(index) for index in range(150)]
    assert truncated is True
    assert len(calls) == 2
    assert calls[0][1]["limit"] == 100
    assert calls[0][1]["access_token"] == "secret"
    assert calls[1][0].endswith("/ig-account/media")
    assert calls[1][1]["fields"] == calls[0][1]["fields"]
    assert "media_product_type" in calls[0][1]["fields"]
    assert calls[1][1]["access_token"] == "secret"
    assert calls[1][1]["after"] == "cursor-1"


def test_instagram_media_fetch_exact_total_without_next_is_not_truncated(monkeypatch):
    import importlib

    main_module = importlib.import_module("app.main")

    class Response:
        @staticmethod
        def raise_for_status():
            pass

        @staticmethod
        def json():
            return {"data": [{"id": "1"}, {"id": "2"}], "paging": {}}

    class Client:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        @staticmethod
        def get(url, params):
            return Response()

    monkeypatch.setattr(main_module.httpx, "Client", Client)

    posts, truncated = _fetch_ig_posts("ig-account", "secret", limit=2)

    assert [post["id"] for post in posts] == ["1", "2"]
    assert truncated is False


def test_instagram_media_fetch_rejects_malformed_graph_payload(monkeypatch):
    import importlib

    main_module = importlib.import_module("app.main")

    class Response:
        @staticmethod
        def raise_for_status():
            pass

        @staticmethod
        def json():
            return {"data": {"id": "not-an-array"}, "paging": {}}

    class Client:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        @staticmethod
        def get(url, params):
            return Response()

    monkeypatch.setattr(main_module.httpx, "Client", Client)

    with pytest.raises(ValueError, match="data must be a JSON array"):
        _fetch_ig_posts("ig-account", "secret", limit=2)


def test_invalid_instagram_sync_limit_fails_before_binding_or_graph_io(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://unused")
    monkeypatch.setenv("IG_SYNC_POST_LIMIT", "0")

    def should_not_bind():
        raise AssertionError("brand binding must not run for invalid sync config")

    monkeypatch.setattr(instagram_module, "_bound_instagram_configs", should_not_bind)

    result = _sync_and_retrain_pipeline()

    assert result["status"] == "error"
    assert result["results"] == []
    assert "between 1 and 1000" in result["message"]


def test_graph_http_failure_never_logs_access_token(monkeypatch, caplog):
    secret = "must-not-appear-in-logs"
    monkeypatch.setenv("DATABASE_URL", "postgresql://unused")
    monkeypatch.setenv("IG_SYNC_POST_LIMIT", "500")
    monkeypatch.setattr(instagram_module, "_bound_instagram_configs", lambda: [{
        "brand_id": "d2850e10-2788-4833-be1b-cbbb782b68e9",
        "name": "Safe test",
        "niche": "Bakery",
        "instagram_id": "ig-safe",
        "access_token": secret,
    }])

    request = httpx.Request(
        "GET",
        f"https://graph.facebook.com/v25.0/ig-safe?access_token={secret}",
    )
    response = httpx.Response(403, request=request)

    def rejected_profile(*args, **kwargs):
        raise httpx.HTTPStatusError(
            "forbidden",
            request=request,
            response=response,
        )

    monkeypatch.setattr(instagram_module, "_fetch_ig_profile", rejected_profile)
    caplog.set_level(logging.INFO)

    result = _sync_and_retrain_pipeline()

    assert result["status"] == "partial"
    assert result["results"][0]["sync"]["status"] == "failed"
    assert "Graph API" in result["results"][0]["sync"]["error"]
    assert secret not in caplog.text
    assert logging.getLogger("httpx").level >= logging.WARNING


def test_instagram_health_brand_scope_parser_distinguishes_operator_and_empty_scope():
    first = "bfd6dbca-613d-4950-8b1e-45ad7dcf1088"
    second = "15663b0a-d1fc-4cb9-bac2-bb0251307441"
    assert _parse_instagram_health_brand_ids(None) is None
    assert _parse_instagram_health_brand_ids("") == set()
    assert _parse_instagram_health_brand_ids(f" {first}, {second}, {first} ") == {first, second}

    with pytest.raises(Exception) as error:
        _parse_instagram_health_brand_ids("not-a-uuid")
    assert getattr(error.value, "status_code", None) == 422


def test_instagram_health_filters_before_graph_requests(monkeypatch):
    import importlib

    main_module = importlib.import_module("app.main")
    first = "bfd6dbca-613d-4950-8b1e-45ad7dcf1088"
    second = "15663b0a-d1fc-4cb9-bac2-bb0251307441"
    monkeypatch.setenv("DATABASE_URL", "postgresql://unused")
    monkeypatch.setattr(instagram_module, "_bound_instagram_configs", lambda: [
        {
            "brand_id": first,
            "name": "Owned brand",
            "niche": "Fashion",
            "instagram_id": "ig-owned",
            "access_token": "owned-token",
        },
        {
            "brand_id": second,
            "name": "Another tenant",
            "niche": "Beauty",
            "instagram_id": "ig-other",
            "access_token": "other-token",
        },
    ])

    requested_urls = []
    database_scopes = []

    class Cursor:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def execute(self, query, params):
            database_scopes.append(params)

        @staticmethod
        def fetchall():
            return []

    class Connection:
        @staticmethod
        def cursor():
            return Cursor()

        @staticmethod
        def close():
            pass

    monkeypatch.setattr(main_module.psycopg2, "connect", lambda *_args, **_kwargs: Connection())

    class Response:
        status_code = 200

        @staticmethod
        def json():
            return {"username": "verified", "followers_count": 10}

    class Client:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def get(self, url, params):
            requested_urls.append(url)
            return Response()

    monkeypatch.setattr(main_module.httpx, "Client", Client)

    response = client.get(f"/instagram/health?brand_ids={first}")
    assert response.status_code == 200
    assert [item["brand_id"] for item in response.json()["connections"]] == [first]
    assert requested_urls == ["https://graph.facebook.com/v25.0/ig-owned"]
    assert database_scopes == [([first],)]

    requested_urls.clear()
    database_scopes.clear()
    response = client.get("/instagram/health?brand_ids=")
    assert response.status_code == 200
    assert response.json()["connections"] == []
    assert requested_urls == []
    assert database_scopes == []


def test_instagram_media_sync_updates_by_source_id_without_deleting_history():
    class Cursor:
        def __init__(self):
            self.calls = []
            self.fetchone_values = [("post-row", 100)]

        def execute(self, query, params):
            self.calls.append((query, params))

        def fetchone(self):
            return self.fetchone_values.pop(0)

    cursor = Cursor()
    caption = "Verified promo? Yuk order 🎉 #one"
    result = _upsert_instagram_media(cursor, "brand-id", {
        "id": "ig-media-1",
        "caption": caption,
        "like_count": 10,
        "comments_count": 5,
        "media_type": "CAROUSEL_ALBUM",
        "media_product_type": "FEED",
        # Friday 20:00 UTC = Saturday 03:00 WIB.
        "timestamp": "2026-07-03T20:00:00+0000",
    }, current_followers=1000)

    assert result == "updated"
    assert all("DELETE FROM posts" not in query for query, _ in cursor.calls)
    update_query, update_params = cursor.calls[-1]
    assert "instagram_media_id" in update_query
    assert update_params[1] == "FEED"
    assert update_params[3] == 15.0  # preserved 100-follower snapshot, not current 1,000
    assert update_params[4] == 100
    expected = DataPreprocessor.extract_features(caption, "Carousel", 3, is_weekend=True)
    assert update_params[5:12] == (
        bool(expected["is_single_image"]),
        bool(expected["is_carousel"]),
        bool(expected["is_reels"]),
        int(expected["post_hour"]),
        int(expected["caption_length"]),
        int(expected["hashtag_count"]),
        bool(expected["has_cta"]),
    )


@pytest.mark.parametrize(
    ("product_type", "expected_flags"),
    [
        ("REELS", (False, False, True)),
        ("FEED", (False, False, False)),
        (None, (False, False, False)),
    ],
)
def test_video_sync_requires_explicit_reels_product_type(product_type, expected_flags):
    class Cursor:
        def __init__(self):
            self.calls = []

        def execute(self, query, params):
            self.calls.append((query, params))

        @staticmethod
        def fetchone():
            return ("post-row", 100)

    cursor = Cursor()
    post = {
        "id": "ig-video-1",
        "caption": "Verified video",
        "like_count": 10,
        "comments_count": 5,
        "media_type": "VIDEO",
        "timestamp": "2026-07-03T20:00:00+0000",
    }
    if product_type is not None:
        post["media_product_type"] = product_type

    _upsert_instagram_media(cursor, "brand-id", post, current_followers=1000)

    update_params = cursor.calls[-1][1]
    assert update_params[1] == (product_type or "UNKNOWN")
    assert update_params[5:8] == expected_flags


def test_instagram_media_sync_rejects_unknown_media_type():
    class Cursor:
        pass

    with pytest.raises(ValueError, match="Unsupported Instagram media type"):
        _upsert_instagram_media(Cursor(), "brand-id", {
            "id": "ig-media-future",
            "caption": "Future format",
            "like_count": 1,
            "comments_count": 0,
            "media_type": "FUTURE_FORMAT",
            "timestamp": "2026-07-03T20:00:00+0000",
        }, current_followers=100)


def test_brand_patterns_use_only_modeled_mature_rows_and_never_return_raw_content():
    base = datetime.datetime(2026, 5, 1, tzinfo=datetime.timezone.utc)
    rows = []
    for index in range(20):
        carousel = index >= 10
        rows.append({
            "instagram_media_id": f"secret-media-{index}",
            "caption": f"private caption {index} yuk order #promo",
            "er": 5.0 if carousel else 1.0,
            "is_single_image": not carousel,
            "is_carousel": carousel,
            "is_reels": False,
            "media_product_type": "FEED",
            "post_hour": 19 if carousel else 9,
            "caption_length": 30,
            "hashtag_count": 1,
            "has_cta": True,
            "created_at": base + datetime.timedelta(days=index),
            "synced_at": datetime.datetime(2026, 7, 12, tzinfo=datetime.timezone.utc),
        })
    for index in range(2):
        rows.append({
            "instagram_media_id": f"feed-video-{index}",
            "caption": "private feed video caption",
            "er": 99.0,
            "is_single_image": False,
            "is_carousel": False,
            # This reproduces the legacy mistake. Missing REELS product proof
            # must still exclude the row from every median and highlight.
            "is_reels": True,
            "media_product_type": "FEED",
            "post_hour": 20,
            "created_at": base + datetime.timedelta(days=20 + index),
        })

    result = build_brand_patterns(
        rows,
        brand_id="brand-id",
        brand_name="Safe brand",
        niche="Fitness",
        now=datetime.datetime(2026, 7, 12, tzinfo=datetime.timezone.utc),
    )

    assert result["status"] == "success"
    assert result["evidence"]["mature_verified_posts"] == 22
    assert result["evidence"]["eligible_posts"] == 20
    assert result["evidence"]["excluded_unmodeled_posts"] == 2
    assert result["overall"]["median_er"] == 3.0
    assert all(group["key"] != "feed_video_unmodeled" for group in result["patterns"]["formats"])
    assert any(
        item["dimension"] == "format" and item["key"] == "carousel"
        for item in result["highlights"]
    )
    serialized = json.dumps(result)
    assert "private caption" not in serialized
    assert "secret-media" not in serialized
    assert result["freshness"]["external_trends_included"] is False
    assert result["recent_publishing_mix"]["performance_comparison_available"] is False


def test_brand_history_momentum_uses_equal_windows_and_keeps_er_context_non_decisional():
    now = datetime.datetime(2026, 7, 13, tzinfo=datetime.timezone.utc)
    rows = []
    # Prior window: 15 single images and 5 Reels. Recent window: 5 single images
    # and 15 Reels. ER is deliberately much higher in the prior window so the
    # test proves the product reports the distribution but does not call it a
    # performance trend.
    observations = []
    for index in range(20):
        observations.append((170 - index, index >= 15, 10.0 - index / 10))
    for index in range(20):
        observations.append((80 - index, index >= 5, 2.0 + index / 10))
    for index, (days_ago, is_reels, er) in enumerate(observations):
        rows.append({
            "instagram_media_id": f"private-{index}",
            "caption": f"private momentum caption {index}",
            "er": er,
            "is_single_image": not is_reels,
            "is_carousel": False,
            "is_reels": is_reels,
            "media_product_type": "REELS" if is_reels else "FEED",
            "post_hour": 19 if is_reels else 9,
            "created_at": now - datetime.timedelta(days=days_ago),
            "synced_at": now,
        })

    result = build_brand_patterns(
        rows,
        brand_id="brand-id",
        brand_name="Momentum brand",
        niche="Fitness",
        now=now,
    )
    momentum = result["brand_history_momentum"]

    assert momentum["window_days"] == 90
    assert momentum["prior_window"]["posts"] == 20
    assert momentum["recent_window"]["posts"] == 20
    reels = next(
        item for item in momentum["format_mix_changes"] if item["key"] == "reels"
    )
    assert reels == {
        "key": "reels",
        "label": "Reels",
        "recent_sample_size": 15,
        "prior_sample_size": 5,
        "recent_share": 0.75,
        "prior_share": 0.25,
        "share_change_pp": 50.0,
        "evidence_level": "exploratory",
    }
    assert momentum["preferred_mix_statements"][0].startswith(
        "Reels share of mature modeled posts rose from 25% to 75%"
    )
    assert momentum["er_context"]["decision_use_allowed"] is False
    assert momentum["er_context"]["interpretation"] == "descriptive_only_age_confounded"
    assert "equal post-age horizon" in momentum["er_context"]["caveat"]
    reels_er = next(
        item for item in momentum["er_context"]["formats"] if item["key"] == "reels"
    )
    assert reels_er["prior"]["sample_size"] == 5
    assert reels_er["recent"]["sample_size"] == 15
    serialized = json.dumps(momentum)
    assert "private momentum caption" not in serialized
    assert "private-0" not in serialized


def test_brand_patterns_endpoint_validates_brand_and_returns_aggregates(monkeypatch):
    brand_id = "bfd6dbca-613d-4950-8b1e-45ad7dcf1088"
    queries = []

    class Cursor:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            pass

        def execute(self, query, params):
            queries.append((query, params))

        @staticmethod
        def fetchone():
            return {"id": brand_id, "name": "Owned", "niche": "Bakery"}

        @staticmethod
        def fetchall():
            return [{
                "caption": "must not leave service",
                "er": 2.5,
                "is_single_image": True,
                "is_carousel": False,
                "is_reels": False,
                "media_product_type": "FEED",
                "post_hour": 9,
                "caption_length": 22,
                "hashtag_count": 0,
                "has_cta": False,
                "created_at": datetime.datetime(2026, 6, 1, tzinfo=datetime.timezone.utc),
                "synced_at": datetime.datetime(2026, 7, 12, tzinfo=datetime.timezone.utc),
            }]

    class Connection:
        @staticmethod
        def cursor(*_args, **_kwargs):
            return Cursor()

        @staticmethod
        def close():
            pass

    monkeypatch.setattr(patterns_module, "get_db_connection", lambda: Connection())

    response = client.get(f"/brand/patterns?brand_id={brand_id}")

    assert response.status_code == 200
    assert response.json()["brand"]["id"] == brand_id
    assert "must not leave service" not in response.text
    assert "owner_id IS NOT NULL" in queries[0][0]
    assert "source = 'instagram_graph'" in queries[1][0]
    assert "interval '1 day'" in queries[1][0]
    assert queries[1][1] == (brand_id, MIN_POST_AGE_DAYS)


def test_training_query_excludes_unverified_and_feed_video_formats(monkeypatch):
    captured = []

    class Cursor:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            pass

        def execute(self, query, params):
            captured.append((query, params))

        @staticmethod
        def fetchall():
            return []

    class Connection:
        @staticmethod
        def cursor(*_args, **_kwargs):
            return Cursor()

        @staticmethod
        def close():
            pass

    monkeypatch.setattr(ModelTrainer, "_get_db_connection", staticmethod(lambda: Connection()))

    with pytest.raises(InsufficientDataError):
        ModelTrainer.fetch_historical_data(brand_id="brand-id")

    query = captured[0][0]
    assert "is_single_image" in query
    assert "is_carousel" in query
    assert "is_reels AND media_product_type = 'REELS'" in query


def test_model_loader_rejects_artifact_without_verified_post_provenance(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://unused")
    monkeypatch.setattr(ModelLoader, "get_model_metadata", classmethod(lambda cls, brand_id=None, niche=None: {
        "id": "model-id",
        "model_type": "account",
        "storage_url": "https://storage.invalid/model",
        "storage_path": "account/model.joblib",
        "version": "1",
    }))
    monkeypatch.setattr(ModelLoader, "download_model", classmethod(lambda cls, *args: "/tmp/model.joblib"))
    monkeypatch.setattr("app.model_loader.joblib.load", lambda path: {"model": object()})
    ModelLoader._model_cache.clear()

    with pytest.raises(ModelUnavailableError, match="provenance"):
        ModelLoader.load_model(brand_id="brand-id")


def test_model_loader_uses_persisted_brand_niche_for_cohort_fallback(monkeypatch):
    queries = []
    rows = [
        None,
        {"niche": "Fitness"},
        {
            "id": "cohort-model",
            "brand_id": None,
            "niche": "Fitness",
            "model_type": "niche",
        },
    ]

    class Cursor:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            pass

        def execute(self, query, params):
            queries.append((query, params))

        @staticmethod
        def fetchone():
            return rows.pop(0)

    class Connection:
        @staticmethod
        def cursor(*_args, **_kwargs):
            return Cursor()

        @staticmethod
        def close():
            pass

    monkeypatch.setattr(
        ModelLoader, "_get_db_connection", staticmethod(lambda: Connection())
    )

    metadata = ModelLoader.get_model_metadata(
        brand_id="bfd6dbca-613d-4950-8b1e-45ad7dcf1088",
        niche="Wrong caller niche",
    )

    assert metadata["id"] == "cohort-model"
    assert queries[-1][1] == ("Fitness",)
    assert "owner_id IS NOT NULL" in queries[0][0]


def test_model_loader_validates_cache_paths_and_artifact_schema():
    filename = ModelLoader._cache_filename("niche", "../../outside", "v/1")
    assert os.path.basename(filename) == filename
    assert "/" not in filename and "\\" not in filename

    model = _tiny_model()
    valid_bundle = {
        "model": model,
        "features": FEATURE_ORDER_V2,
        "data_provenance": {
            "source": "instagram_graph",
            "identity_key": "instagram_media_id",
        },
    }
    ModelLoader._validate_model_bundle(valid_bundle)

    invalid_bundle = {**valid_bundle, "features": FEATURE_ORDER_V2[:-1]}
    with pytest.raises(ModelUnavailableError, match="feature schema"):
        ModelLoader._validate_model_bundle(invalid_bundle)


def test_model_download_with_secret_key_uses_apikey_and_atomic_cache(
    monkeypatch, tmp_path
):
    import importlib

    loader_module = importlib.import_module("app.model_loader")
    captured_headers = {}

    class Response:
        status_code = 200
        content = b"complete-model-bytes"

    class Client:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            pass

        @staticmethod
        def get(url, headers):
            captured_headers.update(headers)
            return Response()

    monkeypatch.setattr(loader_module, "CACHE_DIR", str(tmp_path))
    monkeypatch.setattr(loader_module.httpx, "Client", Client)
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setenv("SUPABASE_KEY", "sb_secret_example")

    path = ModelLoader.download_model(
        "",
        "niche/model.joblib",
        "model_niche_Fitness_v1.joblib",
    )

    assert Path(path).read_bytes() == b"complete-model-bytes"
    assert captured_headers == {"apikey": "sb_secret_example"}
    assert not list(tmp_path.glob(".model-*"))


def test_model_loader_does_not_expose_storage_exception_details(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://unused")
    monkeypatch.setattr(ModelLoader, "get_model_metadata", classmethod(lambda cls, brand_id=None, niche=None: {
        "id": "model-id",
        "model_type": "account",
        "storage_url": "https://storage.invalid/model",
        "storage_path": "account/model.joblib",
        "version": "1",
    }))
    secret_detail = "signed-storage-token=secret"

    def fail_download(cls, *_args):
        raise RuntimeError(secret_detail)

    monkeypatch.setattr(ModelLoader, "download_model", classmethod(fail_download))
    ModelLoader._model_cache.clear()

    with pytest.raises(ModelUnavailableError) as exc_info:
        ModelLoader.load_model(brand_id="brand-id")
    assert secret_detail not in str(exc_info.value)
    assert "temporarily unavailable" in str(exc_info.value)
