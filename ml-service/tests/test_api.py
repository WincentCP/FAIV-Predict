import json
import os
import sys
import datetime
import pytest
from fastapi.testclient import TestClient

# Adjust path to import app correctly
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.main import app
from app.model_loader import ModelLoader, ModelUnavailableError
from app.preprocessing import CTA_PATTERN

client = TestClient(app)

# The ML service enforces a shared internal token when INTERNAL_API_TOKEN is set
# (as it is via ml-service/.env). Send it on every request, mirroring the BFF.
_token = os.getenv("INTERNAL_API_TOKEN")
if _token:
    client.headers.update({"X-Internal-Token": _token})


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

def test_train_status_without_db_is_honest(monkeypatch):
    """Without a database there is no job state — the service must not fabricate success."""
    monkeypatch.delenv("DATABASE_URL", raising=False)
    response = client.get("/train/00000000-0000-0000-0000-000000000000")
    assert response.status_code == 503


# ── v2 feature set + counterfactuals ────────────────────────────────────────

from app.preprocessing import DataPreprocessor, FEATURE_ORDER_V1, FEATURE_ORDER_V2
from app.train_pipeline import (
    InsufficientDataError,
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
    _get_brands_config,
    _media_insight_value,
    _media_insight_values,
    _parse_instagram_health_brand_ids,
    _upsert_instagram_media,
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
    rows = [
        {"id": "account-new", "brand_id": "brand-1", "model_type": "account", "niche": None},
        {"id": "cohort-old", "brand_id": None, "model_type": "niche", "niche": "Fitness"},
    ]
    selected = effective_models_for_brands(
        rows,
        [{"id": "brand-1", "niche": "Fitness"}],
    )

    assert [row["id"] for row in selected] == ["account-new"]


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


def test_instagram_posts_uses_verified_sync_er_instead_of_current_followers(monkeypatch):
    """Live post cards must not rebase historical ER onto today's audience."""
    import importlib

    main_module = importlib.import_module("app.main")
    brand_id = "bfd6dbca-613d-4950-8b1e-45ad7dcf1088"
    synced_at = datetime.datetime(2026, 7, 10, 4, 30, tzinfo=datetime.timezone.utc)
    executed_queries = []

    monkeypatch.setenv("DATABASE_URL", "postgresql://unused")
    monkeypatch.setattr(main_module, "_get_instagram_connection", lambda _brand_id: {
        "brand_id": brand_id,
        "name": "Verified brand",
        "instagram_id": "17840000000000000",
        "access_token": "token",
    })
    monkeypatch.setattr(main_module, "_fetch_ig_profile", lambda *_args: 1000)

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
            return [("111", 4.2, synced_at)]

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
                    "timestamp": "2026-07-09T12:00:00+0000",
                },
                {
                    "id": "222",
                    "caption": "Not synced yet",
                    "like_count": 900,
                    "comments_count": 100,
                    "media_type": "VIDEO",
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
    assert payload["posts"][0]["tier"] == "Average"
    assert payload["posts"][0]["synced_at"] == synced_at.isoformat()
    assert payload["posts"][1]["er"] is None
    assert payload["posts"][1]["tier"] is None
    assert payload["provenance"]["live_source"] == "instagram_graph_api"
    assert payload["provenance"]["synced_source"] == "production_database_instagram_graph_sync"
    assert all(params == (brand_id,) for _, params in executed_queries)


def test_post_detail_prediction_match_uses_meta_verified_caption(monkeypatch):
    """The caller cannot supply a caption to manufacture a prediction match."""
    import importlib

    main_module = importlib.import_module("app.main")
    brand_id = "bfd6dbca-613d-4950-8b1e-45ad7dcf1088"
    user_id = "15663b0a-d1fc-4cb9-bac2-bb0251307441"
    media_id = "17900000000000001"
    prediction_params = []

    monkeypatch.setenv("DATABASE_URL", "postgresql://unused")
    monkeypatch.setattr(main_module, "_get_instagram_connection", lambda _brand_id: {
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
            if "FROM predictions" in query:
                prediction_params.append(params)

        def fetchone(self):
            if "brand_median_er" in self.query:
                return {"brand_median_er": None}
            if "recent_median_er" in self.query:
                return {"recent_median_er": None}
            return None

        def fetchall(self):
            if "FROM predictions" not in self.query:
                return []
            # Two exact-caption rows are intentionally ambiguous; the API must
            # not arbitrarily pick the newest and present it as this post.
            return [
                {"pred_class": "HIGH", "actual_class": None, "actual_source": None, "model_version": "1", "confidence": "80"},
                {"pred_class": "LOW", "actual_class": None, "actual_source": None, "model_version": "2", "confidence": "70"},
            ]

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
    assert prediction_params == [(brand_id, user_id, "verified graph caption")]
    payload = response.json()
    assert payload["prediction"] is None
    assert payload["prediction_match_status"] == "ambiguous_duplicate_caption"
    assert payload["provenance"]["live_source"] == "instagram_graph_api"


def test_instagram_config_requires_explicit_json(monkeypatch):
    """An absent explicit mapping must remain disconnected."""
    monkeypatch.delenv("IG_BRANDS_JSON", raising=False)
    assert _get_brands_config() == []


def test_instagram_config_validates_and_rejects_duplicate_bindings(monkeypatch):
    brand_id = "bfd6dbca-613d-4950-8b1e-45ad7dcf1088"
    monkeypatch.setenv(
        "IG_BRANDS_JSON",
        json.dumps([{"brand_id": brand_id, "instagram_id": "1784", "access_token": "token"}]),
    )
    config = _get_brands_config()
    assert config == [{"brand_id": brand_id, "instagram_id": "1784", "access_token": "token"}]

    monkeypatch.setenv("IG_BRANDS_JSON", json.dumps([
        {"brand_id": brand_id, "instagram_id": "1784", "access_token": "a"},
        {"brand_id": brand_id, "instagram_id": "1785", "access_token": "b"},
    ]))
    assert _get_brands_config() == []


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
    monkeypatch.setattr(main_module, "_bound_instagram_configs", lambda: [
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
        # Friday 20:00 UTC = Saturday 03:00 WIB.
        "timestamp": "2026-07-03T20:00:00+0000",
    }, current_followers=1000)

    assert result == "updated"
    assert all("DELETE FROM posts" not in query for query, _ in cursor.calls)
    update_query, update_params = cursor.calls[-1]
    assert "instagram_media_id" in update_query
    assert update_params[2] == 15.0  # preserved 100-follower snapshot, not current 1,000
    assert update_params[3] == 100
    expected = DataPreprocessor.extract_features(caption, "Carousel", 3, is_weekend=True)
    assert update_params[4:11] == (
        bool(expected["is_single_image"]),
        bool(expected["is_carousel"]),
        bool(expected["is_reels"]),
        int(expected["post_hour"]),
        int(expected["caption_length"]),
        int(expected["hashtag_count"]),
        bool(expected["has_cta"]),
    )


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
