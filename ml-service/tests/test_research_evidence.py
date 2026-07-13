import datetime as dt
import json

import pandas as pd
import pytest

from app.cumulative_er_sensitivity import build_sensitivity_report, format_markdown
from app.data_volume_report import build_data_volume_report
from app.train_pipeline import training_code_sha256


def _analysis_frame(samples: int = 120) -> pd.DataFrame:
    start = dt.datetime(2025, 1, 1, tzinfo=dt.timezone.utc)
    rows = []
    for index in range(samples):
        format_index = index % 3
        rows.append({
            "brand_id": "brand-1",
            "instagram_media_id": f"private-media-{index}",
            "caption": f"private caption {index} #topic" + (" order now" if index % 2 else ""),
            "er": float(index + 1),
            "is_single_image": format_index == 0,
            "is_carousel": format_index == 1,
            "is_reels": format_index == 2,
            "post_hour": index % 24,
            "created_at": start + dt.timedelta(days=index),
            "caption_length": 20 + index,
            "hashtag_count": 1,
            "has_cta": bool(index % 2),
        })
    return pd.DataFrame(rows)


def test_cumulative_er_sensitivity_is_hash_bound_private_and_reproducible():
    frame = _analysis_frame()
    as_of = dt.datetime(2025, 6, 1, tzinfo=dt.timezone.utc)
    report = build_sensitivity_report(
        frame,
        scope_type="brand",
        scope_value="brand-1",
        analysis_as_of=as_of,
    )
    frozen_hash = report["provenance"]["dataset_sha256"]
    source_hash = report["provenance"]["training_code_sha256"]
    verified = build_sensitivity_report(
        frame,
        scope_type="brand",
        scope_value="brand-1",
        analysis_as_of=as_of,
        expected_dataset_sha256=frozen_hash,
        expected_training_code_sha256=source_hash,
    )

    assert verified["provenance"]["dataset_hash_match"] is True
    assert verified["provenance"]["training_code_hash_match"] is True
    assert verified["post_age_correlation"]["sample_size"] == 120
    assert verified["post_age_correlation"]["pearson_age_days_vs_cumulative_er"] == -1.0
    assert len(verified["age_strata"]) == 3
    assert verified["exclude_oldest_20_percent"]["removed_samples"] == 24
    assert verified["exclude_oldest_20_percent"]["remaining_samples"] == 96
    assert verified["exclude_oldest_20_percent"]["status"] == "evaluated"
    assert set(verified["exclude_oldest_20_percent"]["delta_vs_full_dataset"]) == {
        "balanced_accuracy", "macro_f1", "quadratic_weighted_kappa",
        "accuracy", "ordinal_mae",
    }
    serialized = json.dumps(verified)
    assert "private caption" not in serialized
    assert "private-media" not in serialized
    markdown = format_markdown(verified)
    assert "Post age and cumulative ER" in markdown
    assert "Oldest-cohort exclusion" in markdown

    with pytest.raises(ValueError, match="dataset hash mismatch"):
        build_sensitivity_report(
            frame,
            scope_type="brand",
            scope_value="brand-1",
            analysis_as_of=as_of,
            expected_dataset_sha256="0" * 64,
        )


def test_data_volume_report_maps_thresholds_to_actual_serving_scope():
    served = {
        "data_source": "instagram_graph",
        "identity_key": "instagram_media_id",
        "evaluation_contract": "faiv-thesis-v2",
        "promotion_gate": {"passed": True},
        "evaluation_status": "validated",
        "train_samples": 200,
        "test_samples": 50,
        "dataset": {"dataset_sha256": "a" * 64},
        "training_code_sha256": training_code_sha256(),
    }
    report = build_data_volume_report(
        brands=[
            {"id": "brand-1", "name": "Large brand", "niche": "Bakery"},
            {"id": "brand-2", "name": "Small brand", "niche": "Fitness"},
        ],
        brand_counts=[
            {"brand_id": "brand-1", "eligible_posts": 250},
            {"brand_id": "brand-2", "eligible_posts": 12},
        ],
        niche_counts=[
            {"niche": "Bakery", "eligible_posts": 300},
            {"niche": "Fitness", "eligible_posts": 57},
        ],
        models=[
            {
                "id": "model-account",
                "brand_id": "brand-1",
                "model_type": "account",
                "niche": None,
                "version": "account-v1",
                "metrics": served,
            },
            {
                "id": "model-niche",
                "brand_id": None,
                "model_type": "niche",
                "niche": "Fitness",
                "version": "niche-v1",
                "metrics": {**served, "test_samples": 12},
            },
        ],
        generated_at=dt.datetime(2026, 7, 13, tzinfo=dt.timezone.utc),
    )

    large, small = report["brands"]
    assert large["personal_threshold_met"] is True
    assert large["active_serving_scope"] == "personal"
    assert small["personal_threshold_met"] is False
    assert small["niche_threshold_met"] is True
    assert small["active_serving_scope"] == "niche"
    assert report["coverage_complete"] is True
    assert report["models_with_stale_training_code"] == []
    assert "six observations" in report["small_holdout_caveat"]
    assert report["provenance"]["raw_captions_exported"] is False
