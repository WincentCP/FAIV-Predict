"""Post-age sensitivity analysis for the cumulative-ER thesis limitation.

This module is analysis-only: it reads the same mature, verified observations
as training, fits models in memory, writes no database rows, and never exports
captions or media identifiers. A final run must be bound to the dataset and
training-code hashes frozen by ``app.thesis_evidence``.

Example (inside the final ML container):

    python -m app.cumulative_er_sensitivity \
      --brand-id <uuid> \
      --expected-dataset-sha256 <sha256> \
      --expected-training-code-sha256 <sha256> \
      --format markdown --output /tmp/cumulative-er-sensitivity.md
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
from pathlib import Path
from typing import Any, Dict, Iterable, Optional

import numpy as np
import pandas as pd
import psycopg2
from psycopg2.extras import RealDictCursor

from app.preprocessing import DataPreprocessor
from app.train_pipeline import (
    CANONICAL_CLASS_LABELS,
    MIN_POST_AGE_DAYS,
    _new_random_forest,
    build_classification_evidence,
    build_dataset_evidence,
    training_code_sha256,
)


OLDEST_COHORT_FRACTION = 0.20


def _utc(value: Any) -> pd.Timestamp:
    parsed = pd.to_datetime(value, utc=True, errors="coerce")
    if pd.isna(parsed):
        raise ValueError("analysis data contains an invalid timestamp")
    return parsed


def _correlation(left: Iterable[float], right: Iterable[float]) -> Optional[float]:
    left_array = np.asarray(list(left), dtype=float)
    right_array = np.asarray(list(right), dtype=float)
    if (
        len(left_array) < 2
        or not np.isfinite(left_array).all()
        or not np.isfinite(right_array).all()
        or np.std(left_array) == 0
        or np.std(right_array) == 0
    ):
        return None
    return round(float(np.corrcoef(left_array, right_array)[0, 1]), 6)


def _age_strata(age_days: pd.Series, engagement_rate: pd.Series) -> list[Dict[str, Any]]:
    ordered = pd.DataFrame({"age_days": age_days, "er": engagement_rate}).sort_values(
        ["age_days", "er"], kind="mergesort"
    )
    labels = ("youngest_third", "middle_third", "oldest_third")
    output = []
    for label, positions in zip(labels, np.array_split(np.arange(len(ordered)), 3)):
        if len(positions) == 0:
            continue
        group = ordered.iloc[positions]
        output.append({
            "stratum": label,
            "sample_size": int(len(group)),
            "minimum_post_age_days": round(float(group["age_days"].min()), 4),
            "maximum_post_age_days": round(float(group["age_days"].max()), 4),
            "median_er": round(float(group["er"].median()), 6),
            "q1_er": round(float(group["er"].quantile(0.25)), 6),
            "q3_er": round(float(group["er"].quantile(0.75)), 6),
        })
    return output


def _model_evaluation(data: pd.DataFrame) -> Dict[str, Any]:
    ordered = data.sort_values(
        ["created_at", "instagram_media_id"], kind="mergesort"
    ).reset_index(drop=True)
    features, feature_order = DataPreprocessor.process_dataframe(ordered)
    split_index = int(len(features) * 0.8)
    if split_index < 3 or split_index >= len(features):
        raise ValueError("too few rows for a non-empty chronological 80/20 evaluation")
    train_x = features.iloc[:split_index]
    test_x = features.iloc[split_index:]
    train_er = ordered["er"].astype(float).iloc[:split_index]
    test_er = ordered["er"].astype(float).iloc[split_index:]
    p33, p67 = DataPreprocessor.calculate_percentile_bounds(train_er)
    train_y = train_er.apply(
        lambda value: DataPreprocessor.label_performance(value, p33, p67)
    )
    test_y = test_er.apply(
        lambda value: DataPreprocessor.label_performance(value, p33, p67)
    )
    missing = sorted(set(CANONICAL_CLASS_LABELS) - set(train_y.unique()))
    if missing:
        raise ValueError(
            "training portion cannot express all three tiers after percentile labeling: "
            + ", ".join(missing)
        )
    model = _new_random_forest()
    model.fit(train_x, train_y)
    evidence = build_classification_evidence(test_y, model.predict(test_x))
    return {
        "status": "evaluated",
        "dataset": build_dataset_evidence(ordered, features, feature_order),
        "train_samples": int(len(train_x)),
        "test_samples": int(len(test_x)),
        "p33_threshold": float(p33),
        "p67_threshold": float(p67),
        "test_class_distribution": {
            label: int((test_y == label).sum()) for label in CANONICAL_CLASS_LABELS
        },
        "metrics": evidence,
    }


def _safe_model_evaluation(data: pd.DataFrame) -> Dict[str, Any]:
    try:
        return _model_evaluation(data)
    except (TypeError, ValueError) as exc:
        return {"status": "not_evaluable", "reason": str(exc)}


def _headline_metrics(evaluation: Dict[str, Any]) -> Dict[str, Optional[float]]:
    metrics = evaluation.get("metrics") or {}
    macro = metrics.get("macro") or {}
    return {
        "balanced_accuracy": metrics.get("balanced_accuracy"),
        "macro_f1": macro.get("f1_score"),
        "quadratic_weighted_kappa": metrics.get("quadratic_weighted_kappa"),
        "accuracy": metrics.get("accuracy"),
        "ordinal_mae": metrics.get("ordinal_mae"),
    }


def build_sensitivity_report(
    data: pd.DataFrame,
    *,
    scope_type: str,
    scope_value: str,
    analysis_as_of: dt.datetime,
    expected_dataset_sha256: Optional[str] = None,
    expected_training_code_sha256: Optional[str] = None,
) -> Dict[str, Any]:
    """Build a hash-bound, non-persistent sensitivity report."""
    required = {
        "brand_id", "instagram_media_id", "caption", "er", "is_single_image",
        "is_carousel", "is_reels", "post_hour", "created_at",
    }
    missing_columns = sorted(required - set(data.columns))
    if missing_columns:
        raise ValueError("analysis data is missing columns: " + ", ".join(missing_columns))
    if len(data) < 12:
        raise ValueError("at least 12 eligible observations are required for sensitivity analysis")

    ordered = data.copy()
    ordered["created_at"] = ordered["created_at"].map(_utc)
    ordered["er"] = pd.to_numeric(ordered["er"], errors="raise").astype(float)
    ordered = ordered.sort_values(
        ["created_at", "instagram_media_id"], kind="mergesort"
    ).reset_index(drop=True)
    original = _safe_model_evaluation(ordered)
    if original.get("status") != "evaluated":
        raise ValueError("frozen dataset is not evaluable: " + str(original.get("reason")))

    current_dataset_hash = original["dataset"]["dataset_sha256"]
    current_training_hash = training_code_sha256()
    if expected_dataset_sha256 and expected_dataset_sha256 != current_dataset_hash:
        raise ValueError(
            "dataset hash mismatch: the analysis rows do not match the frozen model evidence"
        )
    if expected_training_code_sha256 and expected_training_code_sha256 != current_training_hash:
        raise ValueError(
            "training-code hash mismatch: rerun training/evidence with the current final source"
        )

    as_of = pd.Timestamp(analysis_as_of)
    if as_of.tzinfo is None:
        as_of = as_of.tz_localize("UTC")
    else:
        as_of = as_of.tz_convert("UTC")
    age_days = (as_of - ordered["created_at"]).dt.total_seconds() / 86_400
    if (age_days < 0).any():
        raise ValueError("analysis_as_of predates one or more eligible posts")

    remove_count = max(1, int(math.floor(len(ordered) * OLDEST_COHORT_FRACTION)))
    reduced = ordered.iloc[remove_count:].reset_index(drop=True)
    sensitivity = _safe_model_evaluation(reduced)
    original_headline = _headline_metrics(original)
    sensitivity_headline = _headline_metrics(sensitivity)
    metric_deltas = {
        name: (
            round(float(sensitivity_headline[name]) - float(value), 6)
            if value is not None and sensitivity_headline.get(name) is not None
            else None
        )
        for name, value in original_headline.items()
    }

    rank_age = pd.Series(age_days).rank(method="average")
    rank_er = ordered["er"].rank(method="average")
    return {
        "report_contract": "faiv-cumulative-er-sensitivity-v1",
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "analysis_as_of": as_of.isoformat(),
        "scope": {"type": scope_type, "value": scope_value},
        "eligibility": {
            "source": "instagram_graph",
            "minimum_post_age_days": MIN_POST_AGE_DAYS,
            "modeled_formats_only": True,
            "observation_policy": "cumulative_at_latest_sync_after_maturity_gate",
        },
        "provenance": {
            "dataset_sha256": current_dataset_hash,
            "expected_dataset_sha256": expected_dataset_sha256,
            "dataset_hash_match": (
                current_dataset_hash == expected_dataset_sha256
                if expected_dataset_sha256 else None
            ),
            "training_code_sha256": current_training_hash,
            "expected_training_code_sha256": expected_training_code_sha256,
            "training_code_hash_match": (
                current_training_hash == expected_training_code_sha256
                if expected_training_code_sha256 else None
            ),
            "raw_captions_exported": False,
            "media_identifiers_exported": False,
            "database_writes_performed": False,
        },
        "post_age_correlation": {
            "sample_size": int(len(ordered)),
            "pearson_age_days_vs_cumulative_er": _correlation(age_days, ordered["er"]),
            "spearman_age_rank_vs_cumulative_er_rank": _correlation(rank_age, rank_er),
        },
        "age_strata": _age_strata(age_days, ordered["er"]),
        "original_full_dataset": {
            **original,
            "headline_metrics": original_headline,
        },
        "exclude_oldest_20_percent": {
            **sensitivity,
            "removed_samples": remove_count,
            "remaining_samples": int(len(reduced)),
            "removed_created_at_through": ordered.iloc[remove_count - 1]["created_at"].isoformat(),
            "headline_metrics": sensitivity_headline,
            "delta_vs_full_dataset": metric_deltas,
        },
        "interpretation_guard": (
            "This sensitivity analysis quantifies post-age confounding; it does not "
            "convert cumulative ER into a fixed-horizon outcome or establish causality."
        ),
    }


def fetch_scope_data(*, brand_id: Optional[str], niche: Optional[str]) -> tuple[pd.DataFrame, dt.datetime]:
    database_url = __import__("os").getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is required; run inside the final ml-service container")
    connection = psycopg2.connect(database_url)
    try:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            where = "p.brand_id = %s" if brand_id else "b.niche = %s"
            value = brand_id or niche
            cursor.execute(
                f"""
                SELECT p.brand_id, p.instagram_media_id, p.caption, p.er,
                       p.is_single_image, p.is_carousel, p.is_reels, p.post_hour,
                       p.follower_count_at_post, p.caption_length, p.hashtag_count,
                       p.has_cta, p.created_at, p.synced_at
                FROM posts p
                JOIN brands b ON b.id = p.brand_id
                WHERE {where}
                  AND p.source = 'instagram_graph'
                  AND p.instagram_media_id IS NOT NULL
                  AND p.er IS NOT NULL
                  AND p.post_hour IS NOT NULL
                  AND p.created_at IS NOT NULL
                  AND p.created_at <= now() - (%s * interval '1 day')
                  AND (
                    p.is_single_image OR p.is_carousel
                    OR (p.is_reels AND p.media_product_type = 'REELS')
                  )
                ORDER BY p.created_at ASC, p.instagram_media_id ASC
                """,
                (value, MIN_POST_AGE_DAYS),
            )
            rows = [dict(row) for row in cursor.fetchall()]
    finally:
        connection.close()
    if not rows:
        raise RuntimeError("no eligible mature verified posts were found for the requested scope")
    synced = [_utc(row.get("synced_at")) for row in rows if row.get("synced_at")]
    if not synced:
        raise RuntimeError("eligible rows have no sync timestamp for a reproducible analysis_as_of")
    return pd.DataFrame(rows), max(synced).to_pydatetime()


def format_markdown(report: Dict[str, Any]) -> str:
    correlation = report["post_age_correlation"]
    original = report["original_full_dataset"]
    reduced = report["exclude_oldest_20_percent"]
    lines = [
        "# Cumulative-ER post-age sensitivity analysis",
        "",
        f"- Scope: `{report['scope']['type']}:{report['scope']['value']}`",
        f"- Analysis as of: `{report['analysis_as_of']}`",
        f"- Dataset SHA-256: `{report['provenance']['dataset_sha256']}`",
        f"- Training-code SHA-256: `{report['provenance']['training_code_sha256']}`",
        f"- Eligible observations: `{correlation['sample_size']}`",
        "- Raw captions/media identifiers exported: `false`",
        "",
        "## Post age and cumulative ER",
        "",
        f"- Pearson correlation (age days vs ER): `{correlation['pearson_age_days_vs_cumulative_er']}`",
        f"- Spearman rank correlation: `{correlation['spearman_age_rank_vs_cumulative_er_rank']}`",
        "",
        "| Age stratum | n | Age range (days) | Median ER | ER IQR |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    for item in report["age_strata"]:
        lines.append(
            f"| {item['stratum']} | {item['sample_size']} | "
            f"{item['minimum_post_age_days']:.1f}-{item['maximum_post_age_days']:.1f} | "
            f"{item['median_er']:.4f} | {item['q1_er']:.4f}-{item['q3_er']:.4f} |"
        )
    lines.extend([
        "",
        "## Oldest-cohort exclusion",
        "",
        f"Removed the oldest `{reduced['removed_samples']}` observations and retained "
        f"`{reduced['remaining_samples']}` observations. Sensitivity status: `{reduced['status']}`.",
        "",
        "| Metric | Full dataset | Excluding oldest 20% | Delta |",
        "| --- | ---: | ---: | ---: |",
    ])
    for label, key in (
        ("Balanced accuracy", "balanced_accuracy"),
        ("Macro-F1", "macro_f1"),
        ("Quadratic weighted kappa", "quadratic_weighted_kappa"),
        ("Raw accuracy", "accuracy"),
        ("Ordinal MAE", "ordinal_mae"),
    ):
        lines.append(
            f"| {label} | {original['headline_metrics'].get(key)} | "
            f"{reduced['headline_metrics'].get(key)} | "
            f"{reduced['delta_vs_full_dataset'].get(key)} |"
        )
    lines.extend([
        "",
        "## Threat to validity: unequal exposure time",
        "",
        "The target is cumulative likes-plus-comments ER observed at the latest "
        "synchronization. Older posts have had more time to accumulate engagement, "
        "so post age can confound both the tier labels and the chronological holdout. "
        f"In this frozen scope, the age/ER Pearson correlation was "
        f"`{correlation['pearson_age_days_vs_cumulative_er']}` and the Spearman rank "
        f"correlation was `{correlation['spearman_age_rank_vs_cumulative_er_rank']}`. "
        f"After removing the oldest 20%, the balanced-accuracy delta was "
        f"`{reduced['delta_vs_full_dataset'].get('balanced_accuracy')}`, the macro-F1 "
        f"delta was `{reduced['delta_vs_full_dataset'].get('macro_f1')}`, and the QWK "
        f"delta was `{reduced['delta_vs_full_dataset'].get('quadratic_weighted_kappa')}`.",
        "",
        "The seven-day maturity rule removes obviously immature posts but does not "
        "equalize exposure time. These sensitivity results therefore quantify, rather "
        "than eliminate, the limitation. Future work must capture engagement snapshots "
        "at a fixed post age (for example, exact 24-hour and seven-day horizons) before "
        "recent and older performance can be compared fairly.",
        "",
        f"> {report['interpretation_guard']}",
        "",
    ])
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    scope = parser.add_mutually_exclusive_group(required=True)
    scope.add_argument("--brand-id")
    scope.add_argument("--niche")
    parser.add_argument("--expected-dataset-sha256")
    parser.add_argument("--expected-training-code-sha256")
    parser.add_argument(
        "--allow-unfrozen",
        action="store_true",
        help="Allow an exploratory run without both frozen hashes; never use for final thesis claims.",
    )
    parser.add_argument("--format", choices=("json", "markdown"), default="markdown")
    parser.add_argument("--output")
    args = parser.parse_args()
    if not args.allow_unfrozen and (
        not args.expected_dataset_sha256 or not args.expected_training_code_sha256
    ):
        parser.error(
            "final analysis requires both expected hashes from the frozen T1.1 evidence; "
            "use --allow-unfrozen only for exploratory checks"
        )
    data, analysis_as_of = fetch_scope_data(brand_id=args.brand_id, niche=args.niche)
    report = build_sensitivity_report(
        data,
        scope_type="brand" if args.brand_id else "niche",
        scope_value=args.brand_id or args.niche,
        analysis_as_of=analysis_as_of,
        expected_dataset_sha256=args.expected_dataset_sha256,
        expected_training_code_sha256=args.expected_training_code_sha256,
    )
    rendered = (
        json.dumps(report, ensure_ascii=False, indent=2, default=str)
        if args.format == "json" else format_markdown(report)
    )
    if args.output:
        output = Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(rendered + "\n", encoding="utf-8")
    else:
        print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
