"""Generate the thesis data-volume and serving-scope statement from live data.

The report contains counts and model provenance only. It does not export
captions, media identifiers, credentials, or model binaries.

Run inside the final ML container after T1.1:

    python -m app.data_volume_report --format markdown \
      --output /tmp/data-volume-and-scope.md
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
from pathlib import Path
from typing import Any, Dict, Iterable, Optional

import psycopg2
from psycopg2.extras import RealDictCursor

from app.thesis_evidence import _is_served_model, configured_brand_ids
from app.train_pipeline import (
    MIN_ACCOUNT_TRAINING_SAMPLES,
    MIN_POST_AGE_DAYS,
    MIN_TRAINING_SAMPLES,
    training_code_sha256,
)


def _metrics(model: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not model:
        return {}
    value = model.get("metrics") or {}
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return {}
    return value if isinstance(value, dict) else {}


def _serving_model(
    brand: Dict[str, Any],
    models: Iterable[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    candidates = [model for model in models if _is_served_model(model)]
    account = next(
        (
            model for model in candidates
            if str(model.get("brand_id") or "") == str(brand.get("id") or "")
            and model.get("model_type") == "account"
        ),
        None,
    )
    if account:
        return account
    return next(
        (
            model for model in candidates
            if not model.get("brand_id")
            and model.get("model_type") == "niche"
            and model.get("niche") == brand.get("niche")
        ),
        None,
    )


def build_data_volume_report(
    *,
    brands: Iterable[Dict[str, Any]],
    brand_counts: Iterable[Dict[str, Any]],
    niche_counts: Iterable[Dict[str, Any]],
    models: Iterable[Dict[str, Any]],
    generated_at: Optional[dt.datetime] = None,
) -> Dict[str, Any]:
    """Build a deterministic count/scope report from already-scoped DB rows."""
    brands = list(brands)
    models = list(models)
    brand_count_map = {
        str(row.get("brand_id")): int(row.get("eligible_posts") or 0)
        for row in brand_counts
    }
    niche_count_map = {
        str(row.get("niche")): int(row.get("eligible_posts") or 0)
        for row in niche_counts
    }
    brand_rows = []
    for brand in brands:
        brand_id = str(brand.get("id") or "")
        niche = str(brand.get("niche") or "")
        eligible = brand_count_map.get(brand_id, 0)
        niche_eligible = niche_count_map.get(niche, 0)
        model = _serving_model(brand, models)
        metrics = _metrics(model)
        serving_scope = (
            "personal" if model and model.get("model_type") == "account"
            else "niche" if model else "none"
        )
        brand_rows.append({
            "brand_id": brand_id,
            "brand_name": str(brand.get("name") or brand_id),
            "niche": niche,
            "eligible_mature_modeled_posts": eligible,
            "personal_threshold": MIN_ACCOUNT_TRAINING_SAMPLES,
            "personal_threshold_met": eligible >= MIN_ACCOUNT_TRAINING_SAMPLES,
            "niche_eligible_mature_modeled_posts": niche_eligible,
            "niche_threshold": MIN_TRAINING_SAMPLES,
            "niche_threshold_met": niche_eligible >= MIN_TRAINING_SAMPLES,
            "active_serving_scope": serving_scope,
            "serving_model": (
                {
                    "id": str(model.get("id") or ""),
                    "version": model.get("version"),
                    "model_type": model.get("model_type"),
                    "evaluation_status": metrics.get("evaluation_status"),
                    "train_samples": metrics.get("train_samples"),
                    "test_samples": metrics.get("test_samples"),
                    "dataset_sha256": (metrics.get("dataset") or {}).get("dataset_sha256"),
                    "training_code_sha256": metrics.get("training_code_sha256"),
                }
                if model else None
            ),
        })

    niche_rows = [
        {
            "niche": niche,
            "eligible_mature_modeled_posts": eligible,
            "threshold": MIN_TRAINING_SAMPLES,
            "threshold_met": eligible >= MIN_TRAINING_SAMPLES,
            "minimum_expected_holdout_at_threshold": (
                MIN_TRAINING_SAMPLES - int(MIN_TRAINING_SAMPLES * 0.8)
            ),
        }
        for niche, eligible in sorted(niche_count_map.items())
    ]
    uncovered = [row["brand_name"] for row in brand_rows if row["active_serving_scope"] == "none"]
    current_hash = training_code_sha256()
    stale_models = [
        row["brand_name"] for row in brand_rows
        if row["serving_model"]
        and row["serving_model"].get("training_code_sha256") != current_hash
    ]
    generated = generated_at or dt.datetime.now(dt.timezone.utc)
    return {
        "report_contract": "faiv-data-volume-scope-v1",
        "generated_at": generated.astimezone(dt.timezone.utc).isoformat(),
        "eligibility": {
            "source": "instagram_graph",
            "minimum_post_age_days": MIN_POST_AGE_DAYS,
            "modeled_formats_only": True,
            "personal_threshold": MIN_ACCOUNT_TRAINING_SAMPLES,
            "niche_threshold": MIN_TRAINING_SAMPLES,
        },
        "provenance": {
            "current_training_code_sha256": current_hash,
            "raw_captions_exported": False,
            "media_identifiers_exported": False,
            "database_writes_performed": False,
        },
        "configured_brand_count": len(brand_rows),
        "covered_brand_count": len(brand_rows) - len(uncovered),
        "coverage_complete": not uncovered and bool(brand_rows),
        "uncovered_brands": uncovered,
        "models_with_stale_training_code": stale_models,
        "brands": brand_rows,
        "niches": niche_rows,
        "small_holdout_caveat": (
            "The minimum 30-post niche cohort produces only about six observations "
            "in the newest 20% holdout. Metrics from such small holdouts are unstable "
            "and must remain exploratory unless the scientific gates pass with broader evidence."
        ),
    }


def fetch_report_inputs(brand_ids: Iterable[str]) -> Dict[str, Any]:
    brand_ids = list(brand_ids)
    if not brand_ids:
        raise RuntimeError(
            "No configured thesis brands. Set IG_BRANDS_JSON or pass --brand-id."
        )
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is required; run inside the final ml-service container")
    connection = psycopg2.connect(database_url)
    try:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(
                """
                SELECT id::text, name, niche
                FROM brands
                WHERE id = ANY(%s::uuid[])
                ORDER BY name, id
                """,
                (brand_ids,),
            )
            brands = [dict(row) for row in cursor.fetchall()]
            missing = sorted(set(brand_ids) - {row["id"] for row in brands})
            if missing:
                raise RuntimeError("Configured brand IDs do not exist: " + ", ".join(missing))

            cursor.execute(
                """
                SELECT b.id::text AS brand_id,
                       COUNT(p.id) FILTER (
                         WHERE p.source = 'instagram_graph'
                           AND p.instagram_media_id IS NOT NULL
                           AND p.er IS NOT NULL
                           AND p.post_hour IS NOT NULL
                           AND p.created_at IS NOT NULL
                           AND p.created_at <= now() - (%s * interval '1 day')
                           AND (
                             p.is_single_image OR p.is_carousel
                             OR (p.is_reels AND p.media_product_type = 'REELS')
                           )
                       )::int AS eligible_posts
                FROM brands b
                LEFT JOIN posts p ON p.brand_id = b.id
                WHERE b.id = ANY(%s::uuid[])
                GROUP BY b.id
                """,
                (MIN_POST_AGE_DAYS, brand_ids),
            )
            brand_counts = [dict(row) for row in cursor.fetchall()]
            niches = sorted({str(row["niche"]) for row in brands if row.get("niche")})
            cursor.execute(
                """
                SELECT b.niche,
                       COUNT(p.id) FILTER (
                         WHERE p.source = 'instagram_graph'
                           AND p.instagram_media_id IS NOT NULL
                           AND p.er IS NOT NULL
                           AND p.post_hour IS NOT NULL
                           AND p.created_at IS NOT NULL
                           AND p.created_at <= now() - (%s * interval '1 day')
                           AND (
                             p.is_single_image OR p.is_carousel
                             OR (p.is_reels AND p.media_product_type = 'REELS')
                           )
                       )::int AS eligible_posts
                FROM brands b
                LEFT JOIN posts p ON p.brand_id = b.id
                WHERE b.niche = ANY(%s::text[])
                GROUP BY b.niche
                """,
                (MIN_POST_AGE_DAYS, niches),
            )
            niche_counts = [dict(row) for row in cursor.fetchall()]
            cursor.execute(
                """
                SELECT m.id::text, m.brand_id::text, m.niche, m.model_type,
                       m.version, m.metrics, m.created_at
                FROM models m
                WHERE (
                  m.brand_id = ANY(%s::uuid[]) AND m.model_type = 'account'
                ) OR (
                  m.brand_id IS NULL AND m.model_type = 'niche'
                  AND m.niche = ANY(%s::text[])
                )
                ORDER BY m.created_at DESC, m.id DESC
                """,
                (brand_ids, niches),
            )
            models = [dict(row) for row in cursor.fetchall()]
    finally:
        connection.close()
    return {
        "brands": brands,
        "brand_counts": brand_counts,
        "niche_counts": niche_counts,
        "models": models,
    }


def format_markdown(report: Dict[str, Any]) -> str:
    lines = [
        "# Data volume and serving-scope statement",
        "",
        f"Generated: `{report['generated_at']}`  ",
        f"Current training-code SHA-256: `{report['provenance']['current_training_code_sha256']}`",
        "",
        "| Brand | Niche | Eligible brand posts | Personal 200 met? | Eligible niche posts | Niche 30 met? | Serving scope | Model version | Model status | Holdout n |",
        "| --- | --- | ---: | --- | ---: | --- | --- | --- | --- | ---: |",
    ]
    for row in report["brands"]:
        model = row["serving_model"] or {}
        lines.append(
            f"| {row['brand_name']} | {row['niche']} | "
            f"{row['eligible_mature_modeled_posts']} | "
            f"{'yes' if row['personal_threshold_met'] else 'no'} | "
            f"{row['niche_eligible_mature_modeled_posts']} | "
            f"{'yes' if row['niche_threshold_met'] else 'no'} | "
            f"{row['active_serving_scope']} | "
            f"{model.get('version') or 'none'} | "
            f"{model.get('evaluation_status') or 'none'} | "
            f"{model.get('test_samples') if model.get('test_samples') is not None else '-'} |"
        )
    lines.extend([
        "",
        f"Coverage: `{report['covered_brand_count']}/{report['configured_brand_count']}` configured brands have a served model.",
        "",
        "Threshold eligibility and actual serving scope are separate facts: a count "
        "meeting 200/30 permits training but does not prove that a candidate passed "
        "the operational gate. The `Serving scope` and model-version columns state "
        "what inference actually resolves for each configured brand.",
        "",
        f"> {report['small_holdout_caveat']}",
        "",
    ])
    if report["models_with_stale_training_code"]:
        lines.extend([
            "**Not final:** these serving models were trained with a different source fingerprint: "
            + ", ".join(report["models_with_stale_training_code"])
            + ". Retrain and re-export T1.1 evidence before citing this table.",
            "",
        ])
    if report["uncovered_brands"]:
        lines.extend([
            "**Uncovered configured brands:** " + ", ".join(report["uncovered_brands"]),
            "",
        ])
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--brand-id", action="append", default=[])
    parser.add_argument("--format", choices=("json", "markdown"), default="markdown")
    parser.add_argument("--output")
    args = parser.parse_args()
    scope = configured_brand_ids(args.brand_id)
    report = build_data_volume_report(**fetch_report_inputs(scope))
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
