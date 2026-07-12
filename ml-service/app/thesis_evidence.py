"""Export the latest trained-model evidence for a bachelor-thesis appendix.

Run inside the ML container so the existing DATABASE_URL is reused safely:

    docker compose exec -T ml-service \
      python -m app.thesis_evidence --format markdown

The exporter never prints connection strings, tokens, captions, or model files.
"""

from __future__ import annotations

import argparse
import json
import os
import uuid
from pathlib import Path
from typing import Any, Dict, Iterable, List

import psycopg2
from psycopg2.extras import RealDictCursor


def _number(value: Any) -> str:
    if isinstance(value, (int, float)):
        return f"{float(value):.4f}"
    return "not recorded"


def _metrics(row: Dict[str, Any]) -> Dict[str, Any]:
    value = row.get("metrics") or {}
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            value = {}
    return value if isinstance(value, dict) else {}


def latest_per_scope(rows: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Keep the newest row for every account/cohort scope."""
    selected: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        scope = (
            f"account:{row.get('brand_id')}"
            if row.get("brand_id")
            else f"niche:{row.get('niche')}"
        )
        selected.setdefault(scope, row)
    return list(selected.values())


def configured_brand_ids(explicit: Iterable[str] = ()) -> List[str]:
    """Resolve a safe, explicit thesis scope without exporting other tenants."""
    candidates = list(explicit)
    raw_config = os.getenv("IG_BRANDS_JSON", "[]")
    try:
        parsed = json.loads(raw_config)
    except json.JSONDecodeError:
        parsed = []
    if isinstance(parsed, list):
        candidates.extend(
            item.get("brand_id")
            for item in parsed
            if isinstance(item, dict) and item.get("brand_id")
        )

    resolved = []
    for candidate in candidates:
        try:
            normalized = str(uuid.UUID(str(candidate)))
        except (ValueError, TypeError, AttributeError):
            continue
        if normalized not in resolved:
            resolved.append(normalized)
    return resolved


def effective_models_for_brands(
    rows: Iterable[Dict[str, Any]],
    configured_brands: Iterable[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Mirror serving policy: newest account model, otherwise newest cohort."""
    rows = list(rows)
    selected: List[Dict[str, Any]] = []
    selected_ids = set()
    uncovered = []
    for brand in configured_brands:
        brand_id = str(brand.get("id") or "")
        account_model = next(
            (
                row for row in rows
                if str(row.get("brand_id") or "") == brand_id
                and row.get("model_type") == "account"
            ),
            None,
        )
        cohort_model = next(
            (
                row for row in rows
                if not row.get("brand_id")
                and row.get("model_type") == "niche"
                and brand.get("niche")
                and row.get("niche") == brand.get("niche")
            ),
            None,
        )
        effective = account_model or cohort_model
        if not effective:
            uncovered.append(brand_id)
            continue
        identity = str(effective.get("id") or id(effective))
        if identity not in selected_ids:
            selected_ids.add(identity)
            selected.append(effective)
    if uncovered:
        raise RuntimeError(
            "No account or cohort model covers configured thesis brands: "
            + ", ".join(uncovered)
        )
    return selected


def format_markdown(rows: Iterable[Dict[str, Any]]) -> str:
    rows = list(rows)
    lines = [
        "# FAIV Predict final model evidence",
        "",
        "Generated from the latest application-append-only `models.metrics` records. Raw captions and secrets are excluded.",
        "",
        "| Scope | Version | Scientific status | Train/Test | Accuracy | Macro F1 | Balanced accuracy | Dummy accuracy | Logistic accuracy | Accuracy gain | Ordinal MAE | QWK | Dataset SHA-256 |",
        "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ]
    for row in rows:
        metrics = _metrics(row)
        candidate = metrics.get("candidate") or {}
        baseline = metrics.get("baseline") or {}
        logistic = ((metrics.get("comparators") or {}).get("logistic_regression") or {})
        dataset = metrics.get("dataset") or {}
        runtime = metrics.get("runtime") or {}
        scope = row.get("brand_name") or row.get("niche") or row.get("brand_id") or "unknown"
        dataset_hash = str(dataset.get("dataset_sha256") or "not recorded")
        if len(dataset_hash) == 64:
            dataset_hash = f"`{dataset_hash}`"
        lines.append(
            "| {scope} | {version} | {status} | {train}/{test} | {accuracy} | {macro_f1} | {balanced} | {baseline} | {logistic} | {gain} | {ordinal_mae} | {qwk} | {dataset_hash} |".format(
                scope=str(scope).replace("|", "\\|"),
                version=row.get("version") or "not recorded",
                status=metrics.get("evaluation_status") or "legacy/not assessed",
                train=metrics.get("train_samples", "?"),
                test=metrics.get("test_samples", "?"),
                accuracy=_number(candidate.get("accuracy", metrics.get("accuracy"))),
                macro_f1=_number((candidate.get("macro") or {}).get("f1_score")),
                balanced=_number(candidate.get("balanced_accuracy")),
                baseline=_number(baseline.get("accuracy")),
                logistic=_number(logistic.get("accuracy")),
                gain=_number(metrics.get("accuracy_gain_over_baseline")),
                ordinal_mae=_number(candidate.get("ordinal_mae")),
                qwk=_number(candidate.get("quadratic_weighted_kappa")),
                dataset_hash=dataset_hash,
            )
        )

    lines.extend(["", "## Reproducibility details", ""])
    for row in rows:
        metrics = _metrics(row)
        dataset = metrics.get("dataset") or {}
        scientific_gate = metrics.get("scientific_gate") or {}
        temporal_summary = ((metrics.get("temporal_evaluation") or {}).get("summary") or {})
        test_distribution = metrics.get("test_class_distribution") or {}
        permutation = metrics.get("holdout_permutation_importance") or {}
        scope = row.get("brand_name") or row.get("niche") or row.get("brand_id") or "unknown"
        lines.extend([
            f"### {scope} — {row.get('version') or 'unknown version'}",
            "",
            f"- Model type: `{row.get('model_type') or 'unknown'}`",
            f"- Chronological split: `{metrics.get('split') or 'not recorded'}`",
            f"- Data window: `{dataset.get('first_post_at') or 'unknown'}` to `{dataset.get('last_post_at') or 'unknown'}`",
            f"- Verified posts: `{dataset.get('verified_posts', metrics.get('verified_posts', 'unknown'))}`",
            "- Held-out class support (LOW/AVERAGE/HIGH): "
            f"`{test_distribution.get('LOW', 'unknown')}/"
            f"{test_distribution.get('AVERAGE', 'unknown')}/"
            f"{test_distribution.get('HIGH', 'unknown')}`",
            f"- Scientific status: `{metrics.get('evaluation_status') or 'not assessed'}`",
            f"- Scientific decision: `{scientific_gate.get('decision') or 'not assessed'}`",
            "- Scientific failure reasons: `" + (
                ", ".join(scientific_gate.get("failure_reasons") or []) or "none"
            ) + "`",
            "- Temporal folds (evaluated/positive/skipped): "
            f"`{temporal_summary.get('evaluated_folds', 'unknown')}/"
            f"{temporal_summary.get('positive_gain_folds', 'unknown')}/"
            f"{temporal_summary.get('skipped_folds', 'unknown')}`",
            f"- Holdout permutation importance available: `{permutation.get('available', False)}`",
            f"- Training code SHA-256: `{metrics.get('training_code_sha256') or 'not recorded'}`",
            f"- Requirements SHA-256: `{runtime.get('requirements_sha256') or 'not recorded'}`",
            f"- Runtime: Python `{runtime.get('python') or 'unknown'}`, scikit-learn `{runtime.get('scikit_learn') or 'unknown'}`, pandas `{runtime.get('pandas') or 'unknown'}`, NumPy `{runtime.get('numpy') or 'unknown'}`",
            f"- Promotion decision: `{(metrics.get('promotion_gate') or {}).get('decision') or 'legacy'}`",
            f"- Evaluation contract: `{metrics.get('evaluation_contract') or 'legacy'}`",
            "",
            "```json",
            json.dumps(metrics, ensure_ascii=False, indent=2, sort_keys=True),
            "```",
            "",
        ])

    lines.extend([
        "## Interpretation boundary",
        "",
        "- `validated` means every implemented scientific gate passed for this internal temporal evaluation; it does not prove external validity for unrepresented brands or future Instagram regimes.",
        "- `exploratory` is an honest usable result with insufficient or inconsistent scientific evidence. It must not be reported as validated merely because the operational promotion gate passed.",
        "- Raw Random Forest class scores are not calibrated probabilities, and counterfactual score changes are not causal engagement uplift.",
        "- The outcome is a relative cumulative likes-and-comments tier using the follower count captured at first observation, not an exact fixed seven-day outcome.",
        "",
    ])
    return "\n".join(lines)


def fetch_rows(brand_ids: Iterable[str]) -> List[Dict[str, Any]]:
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is required; run this command inside ml-service.")
    brand_ids = list(brand_ids)
    if not brand_ids:
        raise RuntimeError(
            "No thesis brand scope was provided. Configure IG_BRANDS_JSON or pass --brand-id."
        )
    connection = psycopg2.connect(database_url)
    try:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(
                """
                SELECT id::text, niche
                FROM public.brands
                WHERE id = ANY(%s::uuid[])
                """,
                (brand_ids,),
            )
            configured_brands = [dict(row) for row in cursor.fetchall()]
            missing_brand_rows = sorted(
                set(brand_ids) - {row["id"] for row in configured_brands}
            )
            if missing_brand_rows:
                raise RuntimeError(
                    "Configured thesis brand IDs do not exist: "
                    + ", ".join(missing_brand_rows)
                )
            cursor.execute(
                """
                SELECT m.id::text, m.brand_id::text, b.name AS brand_name,
                       m.niche, m.model_type, m.version, m.accuracy,
                       m.metrics, m.created_at
                FROM public.models m
                LEFT JOIN public.brands b ON b.id = m.brand_id
                WHERE (
                  m.brand_id = ANY(%s::uuid[])
                  AND m.model_type = 'account'
                  AND m.metrics->>'data_source' = 'instagram_graph'
                  AND m.metrics->>'identity_key' = 'instagram_media_id'
                ) OR (
                  m.brand_id IS NULL
                  AND m.model_type = 'niche'
                  AND m.metrics->>'data_source' = 'instagram_graph'
                  AND m.metrics->>'identity_key' = 'instagram_media_id'
                  AND m.niche IN (
                    SELECT DISTINCT scoped.niche
                    FROM public.brands scoped
                    WHERE scoped.id = ANY(%s::uuid[])
                      AND scoped.niche IS NOT NULL
                  )
                )
                ORDER BY m.created_at DESC, m.id DESC
                """,
                (brand_ids, brand_ids),
            )
            rows = [dict(row) for row in cursor.fetchall()]
            return effective_models_for_brands(rows, configured_brands)
    finally:
        connection.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--format", choices=("markdown", "json"), default="markdown")
    parser.add_argument("--output", help="Optional output path; stdout is used by default.")
    parser.add_argument(
        "--brand-id",
        action="append",
        default=[],
        help="Explicit thesis brand UUID; may be repeated. IG_BRANDS_JSON is also used.",
    )
    args = parser.parse_args()

    scope = configured_brand_ids(args.brand_id)
    rows = latest_per_scope(fetch_rows(scope))
    if not rows:
        raise RuntimeError("No trained model records were found.")
    if args.format == "json":
        rendered = json.dumps(rows, ensure_ascii=False, indent=2, default=str)
    else:
        rendered = format_markdown(rows)

    if args.output:
        path = Path(args.output)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(rendered + "\n", encoding="utf-8")
    else:
        print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
