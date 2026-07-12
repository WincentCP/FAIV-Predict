#!/usr/bin/env python3
"""Static, secret-free release contract for the bachelor-thesis repository."""

from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    workflow_path = ROOT / "n8n" / "workflow_sync_retrain.json"
    workflow_text = workflow_path.read_text(encoding="utf-8")
    workflow = json.loads(workflow_text)
    compose = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    n8n_readme = (ROOT / "n8n" / "README.md").read_text(encoding="utf-8")
    env_example = (ROOT / ".env.example").read_text(encoding="utf-8")
    gitignore = (ROOT / ".gitignore").read_text(encoding="utf-8")
    training_source = (ROOT / "ml-service" / "app" / "train_pipeline.py").read_text(encoding="utf-8")
    inference_source = (ROOT / "ml-service" / "app" / "main.py").read_text(encoding="utf-8")
    brand_patterns_source = (ROOT / "ml-service" / "app" / "brand_patterns.py").read_text(encoding="utf-8")
    schema_source = (ROOT / "supabase_schema.sql").read_text(encoding="utf-8")
    brand_patterns_migration = (
        ROOT / "supabase" / "migrations" / "202607120003_brand_patterns_and_media_product.sql"
    ).read_text(encoding="utf-8")
    cohesion_migration = (
        ROOT / "supabase" / "migrations" / "202607120004_content_lifecycle_integration.sql"
    ).read_text(encoding="utf-8")
    brand_patterns_bff = (
        ROOT / "frontend" / "app" / "api" / "brand-patterns" / "route.ts"
    ).read_text(encoding="utf-8")
    brand_patterns_server_context = (
        ROOT / "frontend" / "lib" / "server" / "brand-pattern-context.ts"
    ).read_text(encoding="utf-8")
    brand_patterns_ui = (
        ROOT
        / "frontend"
        / "app"
        / "(dashboard)"
        / "predict"
        / "_components"
        / "BrandPatterns.tsx"
    ).read_text(encoding="utf-8")
    instagram_posts_bff = (
        ROOT / "frontend" / "app" / "api" / "instagram-posts" / "route.ts"
    ).read_text(encoding="utf-8")
    instagram_post_insights_bff = (
        ROOT / "frontend" / "app" / "api" / "instagram-post-insights" / "route.ts"
    ).read_text(encoding="utf-8")
    insights_ui = (
        ROOT / "frontend" / "app" / "(dashboard)" / "insights" / "page.tsx"
    ).read_text(encoding="utf-8")
    calendar_ui = (
        ROOT / "frontend" / "app" / "(dashboard)" / "calendar" / "page.tsx"
    ).read_text(encoding="utf-8")
    calendar_bff = (
        ROOT / "frontend" / "app" / "api" / "calendar" / "route.ts"
    ).read_text(encoding="utf-8")
    publication_links_bff = (
        ROOT / "frontend" / "app" / "api" / "publication-links" / "route.ts"
    ).read_text(encoding="utf-8")
    predict_ui = (
        ROOT / "frontend" / "app" / "(dashboard)" / "predict" / "page.tsx"
    ).read_text(encoding="utf-8")
    classify_bff = (
        ROOT / "frontend" / "app" / "api" / "classify" / "route.ts"
    ).read_text(encoding="utf-8")
    analyze_concept_bff = (
        ROOT / "frontend" / "app" / "api" / "analyze-concept" / "route.ts"
    ).read_text(encoding="utf-8")
    refine_caption_bff = (
        ROOT / "frontend" / "app" / "api" / "refine-caption" / "route.ts"
    ).read_text(encoding="utf-8")
    powershell_preflight = (ROOT / "scripts" / "thesis_preflight.ps1").read_text(encoding="utf-8")

    require(workflow.get("active") is False, "workflow template must import inactive")
    require("$env" not in workflow_text, "workflow template must not read $env")
    require("example.invalid" in workflow_text, "portable template needs safe email placeholders")
    require(
        not any(node.get("credentials") for node in workflow.get("nodes", [])),
        "portable workflow must not commit installation-specific credential IDs",
    )

    email_nodes = [
        node for node in workflow.get("nodes", [])
        if node.get("type") == "n8n-nodes-base.emailSend"
    ]
    require(len(email_nodes) == 3, "expected exactly three workflow email nodes")
    for node in email_nodes:
        parameters = node.get("parameters", {})
        require(
            parameters.get("emailFormat") == "html" and "emailType" not in parameters,
            f"{node.get('name')} must use the n8n v2 emailFormat schema",
        )

    stop_nodes = [
        node for node in workflow.get("nodes", [])
        if node.get("type") == "n8n-nodes-base.stopAndError"
    ]
    require(
        len(stop_nodes) == 2,
        "unhealthy and partial automation branches must fail their n8n execution",
    )
    connections = workflow.get("connections", {})
    require(
        "Fail Unhealthy Connection Execution"
        in json.dumps(connections.get("Send Connection Warning", {})),
        "health-warning branch must terminate with an error",
    )
    require(
        "Fail Partial Pipeline Execution"
        in json.dumps(connections.get("Send Failure Summary", {})),
        "partial sync/retrain branch must terminate with an error",
    )

    requests = [
        node for node in workflow.get("nodes", [])
        if node.get("type") == "n8n-nodes-base.httpRequest"
    ]
    require(len(requests) == 2, "expected exactly two workflow HTTP Request nodes")
    for node in requests:
        parameters = node.get("parameters", {})
        require(
            parameters.get("authentication") == "genericCredentialType"
            and parameters.get("genericAuthType") == "httpHeaderAuth",
            f"{node.get('name')} must require an encrypted Header Auth credential",
        )
        require(
            str(parameters.get("url", "")).startswith("http://ml-service:8000/"),
            f"{node.get('name')} must use the Docker-private ML URL",
        )

    n8n_service = compose.split("\n  n8n:\n", 1)[1].split("\nvolumes:\n", 1)[0]
    ml_service = compose.split("\n  ml-service:\n", 1)[1].split("\n  frontend:\n", 1)[0]
    require(
        "IG_SYNC_POST_LIMIT=${IG_SYNC_POST_LIMIT:-500}" in ml_service,
        "ML service must receive the bounded historical Instagram sync limit",
    )
    require(
        "N8N_BLOCK_ENV_ACCESS_IN_NODE=true" in n8n_service,
        "Compose must block workflow access to process environment variables",
    )
    require(
        "http://127.0.0.1:5678/healthz/readiness" in n8n_service,
        "n8n healthcheck must verify database readiness, not liveness only",
    )
    for forbidden in (
        "FAIV_ML_URL=",
        "INTERNAL_API_TOKEN=",
        "NOTIFICATION_FROM_EMAIL=",
        "NOTIFICATION_TO_EMAIL=",
        "IG_SYNC_POST_LIMIT=",
    ):
        require(forbidden not in n8n_service, f"n8n service still receives {forbidden}")

    combined_docs = readme + "\n" + n8n_readme
    require(
        "n8n reads `FAIV_ML_URL`" not in combined_docs,
        "documentation still describes the retired environment-secret workflow",
    )
    require(
        "N8N_BLOCK_ENV_ACCESS_IN_NODE=false" not in combined_docs,
        "documentation still instructs operators to disable environment blocking",
    )
    for retired in (
        "FAIV_ML_URL=",
        "NOTIFICATION_FROM_EMAIL=",
        "NOTIFICATION_TO_EMAIL=",
    ):
        require(retired not in env_example, f".env.example still contains retired {retired}")

    for required_training_contract in (
        "MIN_POST_AGE_DAYS = 7",
        '"promotion_gate"',
        '"scientific_gate"',
        '"evaluation_status"',
        '"temporal_evaluation"',
        '"comparators"',
        '"balanced_accuracy"',
        '"ordinal_mae"',
        '"faiv-thesis-v2"',
        '"post_hour_support"',
        "ModelQualityError",
        '"runtime"',
    ):
        require(
            required_training_contract in training_source,
            f"training contract is missing {required_training_contract}",
        )
    require(
        '"empirical_training_distribution"' in inference_source,
        "optional-time inference must use empirical observed-hour support",
    )
    require(
        "ADD COLUMN IF NOT EXISTS media_product_type" in brand_patterns_migration
        and "posts_media_product_type_check" in brand_patterns_migration
        and "media_product_type" in schema_source,
        "Meta product type must be versioned in both migration and canonical schema",
    )
    require(
        '"media_product_type"' in inference_source
        and '"/brand/patterns"' in inference_source
        and "build_brand_patterns" in inference_source,
        "ML service must preserve Meta product type and expose aggregate brand patterns",
    )
    for required_cohesion_contract in (
        "ADD COLUMN IF NOT EXISTS instagram_account_id",
        "brands_profile_summary_length_check",
        "brands_timezone_wib_check",
        "idx_brands_instagram_account_unique",
        "CREATE TABLE IF NOT EXISTS public.prediction_publications",
        "prevent_brand_instagram_identity_change",
        "validate_prediction_publication",
        "link_prediction_publication",
        "verified_media_confirmation",
        "Verified outcomes store continuous ER only; actual_class is not derived.",
        "validate_prediction_observed_outcome",
        "reconcile_prediction_publication_outcomes",
        "GRANT EXECUTE ON FUNCTION public.link_prediction_publication",
        "publication.linked",
        "previous_prediction UUID := OLD.prediction_id",
        "old_prediction_id",
        "new_prediction_id",
    ):
        require(
            required_cohesion_contract in cohesion_migration,
            f"content-lifecycle migration is missing {required_cohesion_contract}",
        )
    require(
        "prediction_publications" in schema_source
        and "instagram_account_id" in schema_source
        and "validate_prediction_observed_outcome" in schema_source
        and "actual_class is not derived" in schema_source,
        "canonical schema must include immutable account/publication and honest outcome contracts",
    )
    require(
        "_bind_instagram_identity" in inference_source
        and "instagram_account_id = COALESCE" in inference_source
        and "_reconcile_prediction_publications" in inference_source
        and "reconcile_prediction_publication_outcomes" in inference_source
        and '"prediction_outcomes_reconciled"' in inference_source,
        "Graph sync must enforce immutable account binding and reconcile mature linked outcomes",
    )
    require(
        "verified_publication_link" in inference_source
        and 'match_method="verified_media_id"' in inference_source
        and inference_source.find("verified_publication_link")
        < inference_source.find("if prediction is None and isinstance(verified_caption"),
        "immutable publication identity must resolve before mutable caption fallback",
    )
    require(
        "confirmed !== true" in publication_links_bff
        and 'eq("created_by", user.id)' in publication_links_bff
        and 'eq("source", "instagram_graph")' in publication_links_bff
        and "prediction_publications" in publication_links_bff
        and '"link_prediction_publication"' in publication_links_bff
        and "p_prediction_id" in publication_links_bff
        and "p_post_id" in publication_links_bff,
        "publication-link BFF must require explicit confirmation and same-user verified media",
    )
    require(
        "validatePredictionLinks" in calendar_bff
        and "Content Plan and prediction must use the same brand" in calendar_bff
        and "prediction_publications" in calendar_bff,
        "Content Plan BFF must preserve same-owner/brand prediction and publication cohesion",
    )
    for required_pattern_contract in (
        "MIN_GROUP_SAMPLES = 5",
        "DIRECTIONAL_GROUP_SAMPLES = 15",
        "MIN_TOTAL_FOR_HIGHLIGHT = 20",
        '"median_er"',
        '"q1_er"',
        '"q3_er"',
        '"recent_publishing_mix"',
        '"audience_demographics"',
        '"visual_style"',
        '"external_trends"',
    ):
        require(
            required_pattern_contract in brand_patterns_source,
            f"brand-pattern evidence contract is missing {required_pattern_contract}",
        )
    require(
        "requireOwnedBrand" in brand_patterns_bff
        and "getRequestUser" in brand_patterns_server_context
        and 'eq("owner_id", user.id)' in brand_patterns_server_context
        and "/brand/patterns" in brand_patterns_server_context,
        "Brand Performance Snapshot BFF must authenticate and authorize brand ownership",
    )
    require(
        "Brand Performance Snapshot" in brand_patterns_ui
        and "/api/brand-patterns" in brand_patterns_ui
        and "Not measured" in brand_patterns_ui,
        "Predict UI must expose observed brand evidence and honest unavailable dimensions",
    )
    require(
        "IQR" in brand_patterns_ui
        and "excluded_unmodeled_posts" in brand_patterns_ui
        and "not statistical-significance" in brand_patterns_ui,
        "Predict UI must disclose dispersion, excluded formats, and non-significance evidence labels",
    )
    require(
        "media_product_type" in instagram_posts_bff
        and "Feed Video (not modeled)" in insights_ui
        and "Video (type unverified)" in insights_ui
        and 'media_type === "VIDEO" ? "Reels"' not in insights_ui,
        "Published-content analytics must distinguish explicit Reels from Feed/unknown video",
    )
    require(
        'normalized === "video"' not in calendar_ui,
        "Calendar import must not guess that a generic video is a Reel",
    )
    require(
        "Predict" in calendar_ui
        and "pending_maturity" in calendar_ui
        and "observed_er" in calendar_ui
        and "plan_id" in predict_ui
        and "persistContentPlan" in predict_ui
        and "/api/publication-links" in insights_ui
        and "Confirm this publication" in insights_ui,
        "Content Plan UI must support prediction handoff and verified publication outcome states",
    )
    require(
        "comparison_eligible" in inference_source
        and "comparison_eligible" in instagram_posts_bff
        and "comparison_eligible" in instagram_post_insights_bff
        and "comparison_eligible" in insights_ui,
        "post-to-history comparisons must expose and preserve eligibility",
    )
    require(
        "actual_tier" not in instagram_post_insights_bff
        and "actual_tier" not in insights_ui
        and "actual_er" in instagram_post_insights_bff
        and "Observed ER" in insights_ui,
        "verified publications must expose continuous ER without inventing actual_class",
    )
    require(
        "recent_median_er" not in inference_source
        and "recent_median_er" not in instagram_post_insights_bff
        and "recent_median_er" not in insights_ui
        and "fixed_horizon_snapshots_unavailable" in inference_source
        and "Recent performance trend unavailable" in insights_ui,
        "unequal-age cumulative ER must never be presented as a recent performance trend",
    )
    for route_name, route_source in (
        ("classify", classify_bff),
        ("analyze-concept", analyze_concept_bff),
        ("refine-caption", refine_caption_bff),
    ):
        require(
            "getRequestUser" in route_source or "requireOwnedBrand" in route_source,
            f"{route_name} Gemini route must require an authenticated user",
        )
        require(
            '"x-goog-api-key"' in route_source and "?key=" not in route_source,
            f"{route_name} Gemini route must keep its key out of request URLs",
        )
    combined_thesis_docs = "\n".join(
        (readme,)
        + tuple(
            (ROOT / path).read_text(encoding="utf-8")
            for path in (
                "docs/THESIS_ML_METHOD.md",
                "docs/DATA_PROVENANCE.md",
                "docs/THESIS_DEMO_RUNBOOK.md",
                "docs/THESIS_TEST_REPORT.md",
            )
        )
    )
    for required_disclosure in (
        "Brand Performance Snapshot",
        "not statistical significance",
        "cumulative ER",
        "external trend",
        "not scored by Random Forest",
        "operator-assisted",
        "public OAuth",
        "Content Plan",
        "immutable Instagram media ID",
        "actual_class",
        "rejects every new",
        "new versioned schema/migration",
    ):
        require(
            required_disclosure.lower() in combined_thesis_docs.lower(),
            f"thesis documentation is missing disclosure: {required_disclosure}",
        )
    require(
        re.search(r"\$[A-Za-z_][A-Za-z0-9_]*:", powershell_preflight) is None,
        "PowerShell variables immediately followed by ':' must use ${Variable} syntax",
    )
    require(
        "foreach ($ParsedModel in $ParsedEvidence)" in powershell_preflight
        and "[int]$Metrics.train_class_distribution" not in powershell_preflight,
        "PowerShell 5.1 model evidence arrays must be flattened before class validation",
    )
    require(
        'evaluation_contract -ne "faiv-thesis-v2"' in powershell_preflight
        and "evaluation_status" in powershell_preflight,
        "runtime preflight must require v2 evidence and disclose scientific status",
    )
    require(
        "from app.train_pipeline import training_code_sha256" in powershell_preflight
        and "$CurrentTrainingCodeHash" in powershell_preflight
        and "$Metrics.training_code_sha256" in powershell_preflight
        and "execute sync/retrain again" in powershell_preflight,
        "runtime preflight must reject model evidence trained by different current source",
    )
    require(
        "posts.media_product_type" in powershell_preflight
        and "202607120003" in powershell_preflight
        and "prediction_publications" in powershell_preflight
        and "predictions" in powershell_preflight
        and "actual_er" in powershell_preflight
        and "validate_prediction_observed_outcome" in powershell_preflight
        and "202607120004" in powershell_preflight
        and "Content Plan/publication-cohesion migrations are applied" in powershell_preflight,
        "runtime preflight must verify migrations 003 and 004",
    )
    for private_evidence_path in ("docs/FINAL_MODEL_EVIDENCE.md",):
        require(
            private_evidence_path in gitignore,
            f"private evidence path is not ignored: {private_evidence_path}",
        )

    for required_path in (
        "docs/THESIS_TEST_REPORT.md",
        "docs/THESIS_DEMO_RUNBOOK.md",
        "docs/THESIS_ML_METHOD.md",
        "docs/DATA_PROVENANCE.md",
        "docs/PRODUCTION_READINESS.md",
    ):
        require((ROOT / required_path).is_file(), f"missing required document: {required_path}")

    print("PASS thesis repository contract: ML evidence, observed brand patterns, content lifecycle cohesion, secure n8n template, docs, and demo artifacts are present")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
