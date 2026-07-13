"""FAIV Predict ML service composition root.

Endpoint behavior lives in focused APIRouter modules. Compatibility re-exports
below keep existing operational scripts and third-party imports working while
new code imports from the owning module directly.
"""

import os

import httpx  # compatibility re-export for legacy test/integration patching
import psycopg2  # compatibility re-export for legacy test/integration patching
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.graph_client import (
    _fetch_ig_posts,
    _fetch_ig_profile,
    _instagram_sync_post_limit,
    _validate_instagram_sync_post_limit,
)
from app.instagram import (
    _bind_instagram_identity,
    _bound_instagram_configs,
    _get_brands_config,
    _get_instagram_connection,
    _media_insight_value,
    _media_insight_values,
    _model_format_for_media,
    _normalized_media_product_type,
    _parse_instagram_health_brand_ids,
    _post_comparison_status,
    _prediction_detail_payload,
    _reconcile_prediction_publications,
    _sync_and_retrain_pipeline,
    _upsert_instagram_media,
    instagram_health,
    instagram_post_insights,
    instagram_posts,
    router as instagram_router,
    sync_instagram_data_now,
)
from app.patterns import brand_patterns, router as patterns_router
from app.predict import (
    _positive_int_mapping,
    build_counterfactuals,
    predict,
    router as predict_router,
)
from app.shared import (
    ALLOW_UNAUTHENTICATED_LOCAL_DEV,
    DEFAULT_INSTAGRAM_SYNC_POST_LIMIT,
    INSTAGRAM_GRAPH_PAGE_SIZE,
    INTERNAL_API_TOKEN,
    KNOWN_INSTAGRAM_PRODUCT_TYPES,
    MAX_INSTAGRAM_HEALTH_BRANDS,
    MAX_INSTAGRAM_SYNC_POST_LIMIT,
    POST_COMPARISON_UNAVAILABLE_REASONS,
    RECENT_PERFORMANCE_UNAVAILABLE_REASON,
    STALE_RETRAIN_JOB_MINUTES,
    SUPPORTED_INSTAGRAM_MEDIA_TYPES,
    UNKNOWN_TIME_SCENARIOS,
    InstagramIdentityBindingError,
    InstagramPostInsightsRequest,
    PredictionRequest,
    TrainRequest,
    get_db_connection,
    logger,
    verify_internal_token,
)
from app.train import (
    _fail_stale_retrain_jobs,
    get_train_status,
    router as train_router,
    run_training_job_async,
    train,
)

__all__ = [
    "app",
    "httpx",
    "psycopg2",
    "ALLOW_UNAUTHENTICATED_LOCAL_DEV",
    "DEFAULT_INSTAGRAM_SYNC_POST_LIMIT",
    "INSTAGRAM_GRAPH_PAGE_SIZE",
    "INTERNAL_API_TOKEN",
    "KNOWN_INSTAGRAM_PRODUCT_TYPES",
    "MAX_INSTAGRAM_HEALTH_BRANDS",
    "MAX_INSTAGRAM_SYNC_POST_LIMIT",
    "POST_COMPARISON_UNAVAILABLE_REASONS",
    "RECENT_PERFORMANCE_UNAVAILABLE_REASON",
    "STALE_RETRAIN_JOB_MINUTES",
    "SUPPORTED_INSTAGRAM_MEDIA_TYPES",
    "UNKNOWN_TIME_SCENARIOS",
    "InstagramIdentityBindingError",
    "InstagramPostInsightsRequest",
    "PredictionRequest",
    "TrainRequest",
    "verify_internal_token",
    "get_db_connection",
    "healthz",
    "predict",
    "train",
    "get_train_status",
    "instagram_health",
    "instagram_posts",
    "instagram_post_insights",
    "sync_instagram_data_now",
    "brand_patterns",
    "build_counterfactuals",
    "run_training_job_async",
    "_positive_int_mapping",
    "_fail_stale_retrain_jobs",
    "_fetch_ig_profile",
    "_validate_instagram_sync_post_limit",
    "_instagram_sync_post_limit",
    "_fetch_ig_posts",
    "_get_brands_config",
    "_bound_instagram_configs",
    "_get_instagram_connection",
    "_parse_instagram_health_brand_ids",
    "_media_insight_value",
    "_media_insight_values",
    "_post_comparison_status",
    "_prediction_detail_payload",
    "_normalized_media_product_type",
    "_model_format_for_media",
    "_bind_instagram_identity",
    "_reconcile_prediction_publications",
    "_upsert_instagram_media",
    "_sync_and_retrain_pipeline",
    "logger",
]

app = FastAPI(
    title="FAIV Predict ML Service",
    description="Microservice Backend for Instagram Content Performance Prediction",
    version="1.0.0",
)

# Explicit allowlist only (never wildcard with credentials).
ALLOWED_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"]
for _origin in os.getenv("FRONTEND_URL", "").split(","):
    _origin = _origin.strip()
    if _origin and _origin != "*" and _origin not in ALLOWED_ORIGINS:
        ALLOWED_ORIGINS.append(_origin)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz", include_in_schema=False)
def healthz():
    """Process liveness probe; dependency health is reported by scoped endpoints."""
    return {"status": "ok"}


app.include_router(predict_router)
app.include_router(train_router)
app.include_router(instagram_router)
app.include_router(patterns_router)
