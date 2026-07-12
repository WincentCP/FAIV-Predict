import os
import re
import json
import uuid
import hashlib
import secrets
import datetime
import logging
from urllib.parse import parse_qs, urlparse
from typing import Optional, Dict, Any, Literal
from fastapi import FastAPI, HTTPException, BackgroundTasks, Depends, Header
from dotenv import load_dotenv
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
import httpx
import numpy as np
import psycopg2
import psycopg2.extras

from app.preprocessing import DataPreprocessor, FEATURE_ORDER_V1
from app.brand_patterns import build_brand_patterns
from app.model_loader import ModelLoader, ModelUnavailableError
from app.train_pipeline import (
    MIN_ACCOUNT_TRAINING_SAMPLES,
    MIN_POST_AGE_DAYS,
    ModelTrainer,
)

# Load the service-local file before reading configuration below. Production
# values supplied by Docker remain authoritative because dotenv does not
# override variables that are already present.
env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
load_dotenv(env_path)

MAX_INSTAGRAM_HEALTH_BRANDS = 100
SUPPORTED_INSTAGRAM_MEDIA_TYPES = {"IMAGE", "CAROUSEL_ALBUM", "VIDEO"}
KNOWN_INSTAGRAM_PRODUCT_TYPES = {"FEED", "REELS", "STORY", "AD"}
POST_COMPARISON_UNAVAILABLE_REASONS = {
    "not_synced": "This post has no verified synchronized engagement rate yet.",
    "immature": "This post is younger than the required seven-day maturity window.",
    "unmodeled_format": "This post's media format is not supported by the prediction model.",
    "incomplete_features": "This synchronized post is missing features required for a like-for-like model comparison.",
    "lookup_unavailable": "Comparison eligibility could not be verified from synchronized history.",
}
RECENT_PERFORMANCE_UNAVAILABLE_REASON = (
    "Recent performance trend is unavailable because cumulative engagement rates "
    "were not captured at an equal post-age horizon. Fixed-horizon metric snapshots "
    "are required before recent and older posts can be compared fairly."
)
DEFAULT_INSTAGRAM_SYNC_POST_LIMIT = 500
MAX_INSTAGRAM_SYNC_POST_LIMIT = 1000
INSTAGRAM_GRAPH_PAGE_SIZE = 100
STALE_RETRAIN_JOB_MINUTES = 30
# Legacy bundles do not carry a learned posting-hour distribution. For them,
# use all clock hours as an explicit provisional fallback. Newer bundles use
# the frequency distribution of hours actually observed in their train split.
UNKNOWN_TIME_SCENARIOS = tuple(range(24))

# Configure Logging
logger = logging.getLogger("main")
logging.basicConfig(level=logging.INFO)
# httpx INFO logs include complete query strings. Meta access tokens are query
# parameters, so request logging must remain suppressed in this service.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

app = FastAPI(
    title="FAIV Predict ML Service",
    description="Microservice Backend for Instagram Content Performance Prediction",
    version="1.0.0"
)

# CORS Configuration - explicit allowlist only (never wildcard with credentials).
# FRONTEND_URL may be a comma-separated list of allowed origins.
ALLOWED_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"]
_frontend_env = os.getenv("FRONTEND_URL", "")
for _origin in _frontend_env.split(","):
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

# ── Service-to-service authentication ──────────────────────────────────────
# The Next.js BFF is the trust boundary (it enforces the Supabase session).
# Requests to this service must carry a shared secret. An explicit, isolated
# local-development override is the only supported unauthenticated mode.
INTERNAL_API_TOKEN = os.getenv("INTERNAL_API_TOKEN")
ALLOW_UNAUTHENTICATED_LOCAL_DEV = os.getenv(
    "ALLOW_UNAUTHENTICATED_LOCAL_DEV", "false"
).lower() == "true"
if not INTERNAL_API_TOKEN and not ALLOW_UNAUTHENTICATED_LOCAL_DEV:
    raise RuntimeError(
        "INTERNAL_API_TOKEN is required. Set an explicit shared secret, or set "
        "ALLOW_UNAUTHENTICATED_LOCAL_DEV=true only for an isolated local sandbox."
    )
if not INTERNAL_API_TOKEN:
    logger.warning(
        "The ML service is running without authentication because "
        "ALLOW_UNAUTHENTICATED_LOCAL_DEV=true. Never enable this in a shared environment."
    )


def verify_internal_token(x_internal_token: Optional[str] = Header(default=None)):
    """Rejects requests that do not present the shared internal token."""
    if not INTERNAL_API_TOKEN and ALLOW_UNAUTHENTICATED_LOCAL_DEV:
        return
    if not x_internal_token or not secrets.compare_digest(
        x_internal_token, str(INTERNAL_API_TOKEN)
    ):
        raise HTTPException(status_code=401, detail="Unauthorized: invalid internal token")


@app.get("/healthz", include_in_schema=False)
def healthz():
    """Process liveness probe; dependency health is reported by scoped endpoints."""
    return {"status": "ok"}

# Pydantic Schemas for Requests
class PredictionRequest(BaseModel):
    """Validated inference payload accepted from the authenticated BFF."""

    model_config = ConfigDict(extra="forbid")

    caption: str = Field(max_length=2200)
    format: Literal["Reels", "Carousel", "Single Image"]
    # A draft may not have a committed posting time yet. Unknown time is not
    # silently replaced with an arbitrary default; inference averages a fixed,
    # documented scenario set and marks the result provisional.
    post_hour: Optional[int] = Field(default=None, strict=True, ge=0, le=23)
    brand_id: Optional[str] = Field(default=None, max_length=36)
    niche: Optional[str] = Field(default=None, max_length=120)
    scheduled_date: str = Field(max_length=10)  # ISO date (YYYY-MM-DD)
    created_by: Optional[str] = Field(default=None, max_length=36)
    supersedes_prediction_id: Optional[str] = Field(default=None, max_length=36)
    supersession_reason: Optional[Literal[
        "inputs_changed", "time_finalized", "manual_rerun"
    ]] = None

    @field_validator("caption")
    @classmethod
    def caption_must_contain_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("caption must contain non-whitespace text")
        return value

    @model_validator(mode="after")
    def supersession_fields_are_coherent(self):
        has_parent = self.supersedes_prediction_id is not None
        has_reason = self.supersession_reason is not None
        if has_parent != has_reason:
            raise ValueError(
                "supersedes_prediction_id and supersession_reason must be supplied together"
            )
        if has_parent and (not self.brand_id or not self.created_by):
            raise ValueError("supersession requires brand_id and created_by")
        return self

class TrainRequest(BaseModel):
    """Validated model scope accepted from the authenticated BFF."""

    model_config = ConfigDict(extra="forbid")

    brand_id: Optional[str] = Field(default=None, max_length=36)
    niche: Optional[str] = Field(default=None, max_length=120)

    @model_validator(mode="after")
    def scope_is_valid(self):
        if not self.brand_id and not self.niche:
            raise ValueError("brand_id or niche is required")
        if self.brand_id:
            try:
                uuid.UUID(self.brand_id)
            except ValueError as exc:
                raise ValueError("brand_id must be a valid UUID") from exc
        if self.niche is not None and not self.niche.strip():
            raise ValueError("niche must contain non-whitespace text")
        return self

class InstagramPostInsightsRequest(BaseModel):
    """Tenant-scoped request for one media node owned by the linked account.

    The caption is deliberately not accepted from the caller. Prediction
    matching uses the caption returned by Meta for the verified media ID so a
    client cannot manufacture a relationship between an Instagram post and a
    prediction.
    """

    model_config = ConfigDict(extra="forbid")

    brand_id: str = Field(pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")
    media_id: str = Field(min_length=1, max_length=64, pattern=r"^[0-9]+$")
    created_by: str = Field(pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")


class InstagramIdentityBindingError(ValueError):
    """Safe operational error for a persistent brand/account mismatch."""

# DB connection helper
def get_db_connection():
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise HTTPException(status_code=500, detail="Database URL not configured")
    return psycopg2.connect(db_url)


def _fail_stale_retrain_jobs(cur) -> int:
    """Close jobs left non-terminal by an interrupted service process."""
    cur.execute(
        """UPDATE model_retrain_jobs
           SET status = 'failed',
               error_message = 'Training was interrupted by a service restart. Queue retraining again.',
               completed_at = timezone('utc'::text, now()),
               finished_at = timezone('utc'::text, now())
           WHERE status IN ('pending', 'running')
             AND created_at < now() - (%s * interval '1 minute')""",
        (STALE_RETRAIN_JOB_MINUTES,),
    )
    return int(cur.rowcount or 0)


def run_training_job_async(job_id: str, brand_id: Optional[str], niche: Optional[str]):
    """Background task runner for model retraining."""
    logger.info(f"Starting background training job: {job_id}")
    db_url = os.getenv("DATABASE_URL")
    conn = None
    try:
        if db_url:
            conn = psycopg2.connect(db_url)
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE model_retrain_jobs SET status = 'running' WHERE id = %s",
                    (job_id,)
                )
                conn.commit()

        # Execute pipeline
        ModelTrainer.run_training(brand_id, niche)

        if db_url and conn:
            with conn.cursor() as cur:
                completed_at = datetime.datetime.now(datetime.timezone.utc)
                cur.execute(
                    """
                    UPDATE model_retrain_jobs 
                    SET status = 'success', completed_at = %s, finished_at = %s 
                    WHERE id = %s
                    """,
                    (completed_at, completed_at, job_id)
                )
                conn.commit()
            logger.info(f"Background training job {job_id} succeeded.")
    except Exception:
        logger.exception("Background training job %s failed", job_id)
        if db_url and conn:
            try:
                with conn.cursor() as cur:
                    completed_at = datetime.datetime.now(datetime.timezone.utc)
                    cur.execute(
                        """UPDATE model_retrain_jobs
                           SET status = 'failed', error_message = %s,
                               completed_at = %s, finished_at = %s
                           WHERE id = %s""",
                        (
                            "Training failed. Inspect the ML service logs for the cause.",
                            completed_at,
                            completed_at,
                            job_id,
                        )
                    )
                    conn.commit()
            except Exception as inner_e:
                logger.error(f"Failed to record failure in DB for job {job_id}: {inner_e}")
    finally:
        if conn:
            conn.close()


def _positive_int_mapping(value: Any, *, minimum: int = 0, maximum: int | None = None) -> Dict[int, int]:
    """Normalize artifact count mappings without trusting serialized key types."""
    normalized: Dict[int, int] = {}
    if not isinstance(value, dict):
        return normalized
    for raw_key, raw_count in value.items():
        try:
            key = int(raw_key)
            count = int(raw_count)
        except (TypeError, ValueError, OverflowError):
            continue
        if key < minimum or (maximum is not None and key > maximum) or count <= 0:
            continue
        normalized[key] = count
    return normalized


def build_counterfactuals(
    model,
    base_features,
    feature_order,
    classes,
    base_probs,
    *,
    post_hour_support=None,
    feature_reference_values=None,
):
    """
    What-if analysis: re-scores single-feature variants of the SAME draft with
    the SAME model and reports the measured change in the raw High-class score.
    The score change is model-derived, not a causal uplift estimate. Candidate
    values come from the artifact's training split wherever those values are
    available; probes never invent an unsupported posting hour.
    """
    class_list = [str(c).upper() for c in classes]
    if "HIGH" not in class_list:
        return [], (
            "This model's training data produced no High tier, so what-if "
            "analysis is unavailable for it."
        )
    hi = class_list.index("HIGH")
    base_high = round(float(base_probs[hi]) * 100, 1)
    base_class = str(classes[int(np.argmax(base_probs))]).upper()

    probes = []  # (parameter, change, from_value, to_value, overrides)
    reference_values = (
        feature_reference_values if isinstance(feature_reference_values, dict) else {}
    )
    hour = int(base_features.get("post_hour", 0))
    supported_hours = sorted(
        _positive_int_mapping(post_hour_support, minimum=0, maximum=23)
    )
    for h in supported_hours:
        if h != hour:
            probes.append(("post_hour", f"Move posting time to {h}:00", hour, h, {"post_hour": float(h)}))
    if base_features.get("has_cta", 0.0) == 0.0:
        probes.append(("has_cta", "Add a call-to-action", "No", "Yes", {"has_cta": 1.0}))
    tags = int(base_features.get("hashtag_count", 0.0))
    reference_tags = reference_values.get("hashtag_count_median")
    if isinstance(reference_tags, (int, float)):
        reference_tags = max(0, int(round(reference_tags)))
        if tags != reference_tags:
            probes.append((
                "hashtag_count",
                f"Compare with the training median of {reference_tags} hashtags",
                tags,
                reference_tags,
                {"hashtag_count": float(reference_tags)},
            ))
    length = int(base_features.get("caption_length", 0.0))
    reference_length = reference_values.get("caption_length_median")
    if isinstance(reference_length, (int, float)):
        reference_length = max(0, int(round(reference_length)))
        if length != reference_length:
            probes.append((
                "caption_length",
                f"Compare with the training median of about {reference_length} characters",
                length,
                reference_length,
                {"caption_length": float(reference_length)},
            ))
    fmt_flags = {"Reels": "is_reels", "Carousel": "is_carousel", "Single Image": "is_single_image"}
    current_fmt = next((n for n, f in fmt_flags.items() if base_features.get(f, 0.0) == 1.0), None)
    for name, flag in fmt_flags.items():
        if name != current_fmt:
            probes.append(("format", f"Switch format to {name}", current_fmt or "—", name,
                           {v: (1.0 if v == flag else 0.0) for v in fmt_flags.values()}))
    if "is_weekend" in feature_order:
        wk = base_features.get("is_weekend", 0.0)
        probes.append((
            "is_weekend",
            "Schedule for a weekend" if wk == 0.0 else "Schedule for a weekday",
            "Weekday" if wk == 0.0 else "Weekend",
            "Weekend" if wk == 0.0 else "Weekday",
            {"is_weekend": 0.0 if wk else 1.0},
        ))

    if not probes:
        return [], None

    matrix = []
    for _, _, _, _, overrides in probes:
        variant = dict(base_features)
        variant.update(overrides)
        matrix.append(DataPreprocessor.features_to_list(variant, feature_order))
    prob_rows = model.predict_proba(matrix)

    results = []
    for (parameter, change, from_value, to_value, _), row in zip(probes, prob_rows):
        to_high = round(float(row[hi]) * 100, 1)
        new_class = str(classes[int(np.argmax(row))]).upper()
        results.append({
            "parameter": parameter,
            "change": change,
            "from_value": from_value,
            "to_value": to_value,
            "from_prob_high": base_high,
            "to_prob_high": to_high,
            "delta_high": round(to_high - base_high, 1),
            "new_predicted_class": new_class.title(),
            "tier_changed": new_class != base_class,
        })

        # Keep only the best artifact-supported posting hour so the UI remains
        # useful without presenting unsupported/extrapolated schedules.
    hour_rows = [r for r in results if r["parameter"] == "post_hour"]
    if hour_rows:
        best = max(hour_rows, key=lambda r: r["to_prob_high"])
        results = [r for r in results if r["parameter"] != "post_hour"] + [best]

    results.sort(key=lambda r: r["delta_high"], reverse=True)
    return results, None


@app.post("/predict", dependencies=[Depends(verify_internal_token)])
def predict(req: PredictionRequest):
    """
    Extracts features, loads the appropriate Random Forest model (personal or niche),
    classifies the performance tier, and returns uncalibrated raw class scores.
    Persists brand-scoped predictions with authenticated-user provenance.
    """
    try:
        if req.brand_id:
            try:
                uuid.UUID(req.brand_id)
                uuid.UUID(str(req.created_by or ""))
                if req.supersedes_prediction_id:
                    uuid.UUID(req.supersedes_prediction_id)
            except ValueError:
                raise HTTPException(
                    status_code=400,
                    detail="brand_id, created_by, and supersedes_prediction_id must be valid UUIDs.",
                )

        try:
            sched_date = datetime.date.fromisoformat(req.scheduled_date)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail="scheduled_date must be a real ISO date (YYYY-MM-DD).",
            )

        # 1. Load model and bounds bundle (real trained model only)
        try:
            bundle, metadata = ModelLoader.load_model(brand_id=req.brand_id, niche=req.niche)
        except ModelUnavailableError as mue:
            # Honest "no trained model yet" signal instead of a fabricated result
            raise HTTPException(status_code=503, detail=str(mue))

        # The bundle's own stored feature list drives vector order so old
        # 7-feature artifacts keep working after the feature set grew.
        feature_order = bundle.get("features") or FEATURE_ORDER_V1
        feature_schema_version = "sha256:" + hashlib.sha256(
            "|".join(feature_order).encode("utf-8")
        ).hexdigest()
        input_hash = hashlib.sha256(json.dumps(
            {
                "brand_id": req.brand_id,
                "caption": req.caption,
                "format": req.format,
                "scheduled_date": req.scheduled_date,
                "post_hour": req.post_hour,
            },
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")).hexdigest()

        # Extract components from bundle
        model = bundle["model"]
        classes = model.classes_

        # 2. Extract features and score. A known time produces the normal
        # single-vector prediction. An unknown time is evaluated across a
        # artifact-supported set of hours and averaged, making the result
        # explicitly provisional instead of pretending that 19:00 was chosen.
        time_known = req.post_hour is not None
        scenario_support_basis = "exact_time"
        scenario_weights = None
        if time_known:
            scenario_hours = [req.post_hour]
        else:
            scenario_hours = list(UNKNOWN_TIME_SCENARIOS)
            support = bundle.get("post_hour_support")
            parsed_support = []
            if isinstance(support, dict):
                for raw_hour, raw_count in support.items():
                    try:
                        hour = int(raw_hour)
                        count = int(raw_count)
                    except (TypeError, ValueError, OverflowError):
                        continue
                    if 0 <= hour <= 23 and count > 0:
                        parsed_support.append((hour, count))
            if parsed_support:
                parsed_support.sort(key=lambda item: item[0])
                scenario_hours = [hour for hour, _ in parsed_support]
                counts = np.asarray([count for _, count in parsed_support], dtype=float)
                scenario_weights = counts / counts.sum()
                scenario_support_basis = "empirical_training_distribution"
            else:
                # Legacy bundles lack exact observed-hour counts. Keep their
                # broad all-hours fallback explicit instead of interpolating
                # unseen hours between a min/max range.
                scenario_support_basis = "legacy_all_hours"
        scenario_features = [
            DataPreprocessor.extract_features(
                caption=req.caption,
                format_type=req.format,
                post_hour=int(hour),
                is_weekend=sched_date.weekday() >= 5,
            )
            for hour in scenario_hours
        ]
        feature_matrix = [
            DataPreprocessor.features_to_list(row, feature_order)
            for row in scenario_features
        ]
        scenario_probabilities = model.predict_proba(feature_matrix)
        probs_raw = (
            np.average(scenario_probabilities, axis=0, weights=scenario_weights)
            if scenario_weights is not None
            else np.mean(scenario_probabilities, axis=0)
        )
        pred_raw = classes[int(np.argmax(probs_raw))]
        # Keep one middle scenario vector for non-time explanations. The stored
        # feature explicitly replaces its hour with null when time is unknown.
        features = scenario_features[len(scenario_features) // 2]
        out_of_range = DataPreprocessor.out_of_range_features(
            features, bundle.get("feature_ranges")
        )
        if not time_known:
            out_of_range = [name for name in out_of_range if name != "post_hour"]
        
        # Map the class and raw Random Forest vote proportions to Title Case
        # for frontend compatibility. These scores are not calibrated probabilities.
        predicted_class = pred_raw.title()
        probabilities = {classes[i].title(): round(float(probs_raw[i]) * 100, 2) for i in range(len(classes))}
        confidence = round(float(np.max(probs_raw)) * 100, 2)
        
        # Determine if personal model or shared niche was active
        is_personal_model_active = metadata.get("model_type") == "account"

        # 4. Assemble every model-derived response field before persistence so
        # an explainability failure cannot leave a history row for a response
        # the caller never received.
        feature_names = feature_order
        feature_importances = {}
        if hasattr(model, "feature_importances_"):
            mdi_raw = model.feature_importances_
            for i, name in enumerate(feature_names):
                if i < len(mdi_raw):
                    feature_importances[name] = round(float(mdi_raw[i]), 4)

        # Counterfactual what-if analysis is complete only when every model
        # input is known. For an unknown time, expose only the best measured
        # hour scenario and explain why the remaining recommendations wait.
        if time_known:
            counterfactuals, cf_note = build_counterfactuals(
                model,
                features,
                feature_order,
                classes,
                probs_raw,
                post_hour_support=bundle.get("post_hour_support"),
                feature_reference_values=bundle.get("feature_reference_values"),
            )
        else:
            class_list = [str(value).upper() for value in classes]
            counterfactuals = []
            if "HIGH" in class_list:
                high_index = class_list.index("HIGH")
                base_high = round(float(probs_raw[high_index]) * 100, 1)
                best_index = int(np.argmax(scenario_probabilities[:, high_index]))
                best_probs = scenario_probabilities[best_index]
                best_hour = scenario_hours[best_index]
                best_class = str(classes[int(np.argmax(best_probs))]).title()
                best_high = round(float(best_probs[high_index]) * 100, 1)
                counterfactuals.append({
                    "parameter": "post_hour",
                    "change": f"Set posting time to {best_hour}:00",
                    "from_value": "Not set",
                    "to_value": best_hour,
                    "from_prob_high": base_high,
                    "to_prob_high": best_high,
                    "delta_high": round(best_high - base_high, 1),
                    "new_predicted_class": best_class,
                    "tier_changed": best_class.upper() != str(pred_raw).upper(),
                })
            scenario_description = (
                "the frequency-weighted hours observed in this model's training split"
                if scenario_support_basis == "empirical_training_distribution"
                else "all 24 hours because this legacy bundle has no observed-hour metadata"
            )
            cf_note = (
                "Posting time is not set. This provisional tier averages "
                f"{scenario_description}. Set a time and re-analyze "
                "for complete what-if recommendations."
            )

        # Training-set size for the trust display (metrics may be a JSON string
        # depending on the driver).
        trained_samples = None
        test_samples = None
        macro_f1 = None
        balanced_accuracy = None
        baseline_accuracy = None
        accuracy_gain_over_baseline = None
        held_out_classes_complete = None
        evaluation_status = None
        scientific_gate_passed = None
        metrics_blob = metadata.get("metrics")
        if isinstance(metrics_blob, str):
            try:
                metrics_blob = json.loads(metrics_blob)
            except ValueError:
                metrics_blob = None
        if isinstance(metrics_blob, dict):
            trained_samples = metrics_blob.get("train_samples")
            test_samples = metrics_blob.get("test_samples")
            candidate_metrics = metrics_blob.get("candidate") or {}
            baseline_metrics = metrics_blob.get("baseline") or {}
            macro_metrics = candidate_metrics.get("macro") or {}
            macro_f1 = macro_metrics.get("f1_score")
            balanced_accuracy = candidate_metrics.get("balanced_accuracy")
            baseline_accuracy = baseline_metrics.get("accuracy")
            accuracy_gain_over_baseline = metrics_blob.get("accuracy_gain_over_baseline")
            evaluation_status = metrics_blob.get("evaluation_status")
            scientific_gate = metrics_blob.get("scientific_gate") or {}
            scientific_gate_passed = scientific_gate.get("passed")
            scientific_criteria = scientific_gate.get("hard_criteria") or {}
            held_out_classes_complete = scientific_criteria.get(
                "all_held_out_classes_present"
            )

        # 5. Persist only the fully assembled prediction. Brand-scoped requests
        # are successful only when creator provenance is durably recorded.
        prediction_id = None
        db_url = os.getenv("DATABASE_URL")
        if db_url and req.brand_id:
            conn = None
            try:
                conn = psycopg2.connect(db_url)
                with conn.cursor() as cur:
                    json_features = {k: float(v) for k, v in features.items()}
                    if not time_known:
                        json_features["post_hour"] = None
                        json_features["time_scenarios"] = scenario_hours
                        if scenario_weights is not None:
                            json_features["time_scenario_weights"] = [
                                round(float(weight), 8) for weight in scenario_weights
                            ]
                    json_features["confidence"] = confidence
                    json_features["time_known"] = time_known
                    prediction_status = "current" if time_known else "provisional"
                    cur.execute(
                        """
                        INSERT INTO predictions (
                            brand_id, created_by, title, caption, features,
                            pred_class, created_at, scheduled_date, model_version,
                            model_id, feature_schema_version, input_hash,
                            prediction_status, time_known, supersedes_prediction_id,
                            supersession_reason
                        )
                        SELECT %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                        WHERE EXISTS (
                            SELECT 1 FROM brands WHERE id = %s AND owner_id = %s
                        )
                          AND (
                            %s IS NULL OR EXISTS (
                                SELECT 1 FROM predictions previous
                                WHERE previous.id = %s
                                  AND previous.brand_id = %s
                                  AND previous.created_by = %s
                            )
                          )
                        RETURNING id
                        """,
                        (
                            req.brand_id,
                            req.created_by,
                            f"{req.format} prediction - {datetime.date.today().strftime('%d/%m/%y')}",
                            req.caption,
                            psycopg2.extras.Json(json_features),
                            predicted_class.upper(),
                            datetime.datetime.now(datetime.timezone.utc),
                            sched_date,
                            metadata.get("version"),
                            metadata.get("id"),
                            feature_schema_version,
                            input_hash,
                            prediction_status,
                            time_known,
                            req.supersedes_prediction_id,
                            req.supersession_reason,
                            req.brand_id,
                            req.created_by,
                            req.supersedes_prediction_id,
                            req.supersedes_prediction_id,
                            req.brand_id,
                            req.created_by,
                        ),
                    )
                    inserted = cur.fetchone()
                    if not inserted:
                        raise ValueError("Prediction ownership or supersession validation failed")
                    prediction_id = str(inserted[0])
                    if req.supersedes_prediction_id:
                        cur.execute(
                            """UPDATE predictions
                               SET prediction_status = 'superseded',
                                   stale_reason = CASE %s
                                     WHEN 'inputs_changed' THEN 'Recalculated after model input changes'
                                     WHEN 'time_finalized' THEN 'Recalculated after posting time was finalized'
                                     ELSE 'Manually re-evaluated'
                                   END,
                                   stale_at = COALESCE(stale_at, timezone('utc'::text, now()))
                               WHERE id = %s AND brand_id = %s AND created_by = %s""",
                            (
                                req.supersession_reason,
                                req.supersedes_prediction_id,
                                req.brand_id,
                                req.created_by,
                            ),
                        )
                    conn.commit()
            except Exception as log_err:
                logger.error("Prediction persistence failed: %s", log_err)
                raise HTTPException(
                    status_code=503,
                    detail="Prediction could not be saved with user provenance; no result was returned.",
                )
            finally:
                if conn:
                    conn.close()

        return {
            "status": "success",
            "predicted_class": predicted_class,
            "confidence": confidence,
            "probabilities": probabilities,
            "prediction_id": prediction_id,
            "prediction_context": {
                "status": "current" if time_known else "provisional",
                "time_known": time_known,
                "scenario_hours": [] if time_known else scenario_hours,
                "scenario_support_basis": scenario_support_basis,
                "scenario_weights": (
                    [] if time_known or scenario_weights is None
                    else [round(float(weight), 8) for weight in scenario_weights]
                ),
                "input_hash": input_hash,
                "feature_schema_version": feature_schema_version,
            },
            "model_metadata": {
                "model_id": metadata.get("id"),
                "model_type": metadata.get("model_type"),
                "version": metadata.get("version"),
                # Validated accuracy from training (newest 20% of posts) so the
                # UI can show how trustworthy this model has proven to be.
                "accuracy": float(metadata["accuracy"]) if metadata.get("accuracy") is not None else None,
                "is_personal_model_active": is_personal_model_active,
                "feature_names": feature_order,
                "trained_samples": trained_samples,
                "test_samples": test_samples,
                "macro_f1": macro_f1,
                "balanced_accuracy": balanced_accuracy,
                "baseline_accuracy": baseline_accuracy,
                "accuracy_gain_over_baseline": accuracy_gain_over_baseline,
                "held_out_classes_complete": held_out_classes_complete,
                "evaluation_status": evaluation_status,
                "scientific_gate_passed": scientific_gate_passed,
            },
            "feature_importances": feature_importances,
            "out_of_range": out_of_range,
            "counterfactuals": counterfactuals,
            "counterfactuals_note": cf_note
        }
    except HTTPException:
        raise
    except Exception:
        logger.exception("Prediction failed")
        raise HTTPException(
            status_code=500,
            detail="Prediction could not be completed due to an internal service error.",
        )


@app.post("/train", dependencies=[Depends(verify_internal_token)])
def train(req: TrainRequest, background_tasks: BackgroundTasks):
    """
    Triggers model retraining. Starts a background thread task to prevent API timeout.
    Returns the retrain job database ID and current state.
    """
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise HTTPException(
            status_code=503,
            detail="Cannot queue retraining: DATABASE_URL is not configured.",
        )
    job_id = str(uuid.uuid4())
    resolved_niche = req.niche
    
    # Register job in DB
    conn = None
    try:
        conn = psycopg2.connect(db_url)
        with conn.cursor() as cur:
            if req.brand_id:
                cur.execute(
                    """SELECT niche FROM brands
                       WHERE id = %s AND owner_id IS NOT NULL LIMIT 1""",
                    (req.brand_id,),
                )
                brand = cur.fetchone()
                if not brand:
                    raise HTTPException(status_code=404, detail="Brand was not found.")
                resolved_niche = brand[0]
            reconciled_jobs = _fail_stale_retrain_jobs(cur)
            if reconciled_jobs:
                logger.warning(
                    "Marked %s interrupted retraining job(s) as failed before queueing.",
                    reconciled_jobs,
                )
            cur.execute(
                """
                INSERT INTO model_retrain_jobs (id, brand_id, status, created_at)
                VALUES (%s, %s, 'pending', %s)
                """,
                (job_id, req.brand_id, datetime.datetime.now(datetime.timezone.utc))
            )
            conn.commit()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to record retrain job in database: {e}")
        raise HTTPException(status_code=503, detail="Cannot queue retraining: job store is unavailable.")
    finally:
        if conn:
            conn.close()
    
    # Run in background
    background_tasks.add_task(
        run_training_job_async, job_id, req.brand_id, resolved_niche
    )
    
    return {
        "status": "pending",
        "job_id": job_id,
        "message": "Retraining job queued successfully in background."
    }


@app.get("/train/{job_id}", dependencies=[Depends(verify_internal_token)])
def get_train_status(job_id: str):
    """Retrieves the status of a background retraining job from database."""
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        # Never fabricate a completed job: without a database there is no job state.
        raise HTTPException(
            status_code=503,
            detail="Job status unavailable: DATABASE_URL is not configured."
        )
    conn = None
    try:
        from psycopg2.extras import RealDictCursor
        conn = psycopg2.connect(db_url)
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT status, error_message, created_at, completed_at FROM model_retrain_jobs WHERE id = %s",
                (job_id,)
            )
            row = cur.fetchone()
            if row:
                res = dict(row)
                # Parse datetime objects for JSON serialization
                if res.get("created_at"):
                    res["created_at"] = res["created_at"].isoformat()
                if res.get("completed_at"):
                    res["completed_at"] = res["completed_at"].isoformat()
                return res
            raise HTTPException(status_code=404, detail="Job not found")
    except HTTPException:
        raise
    except Exception:
        logger.exception("Failed to query train status")
        raise HTTPException(
            status_code=503,
            detail="Job status is temporarily unavailable.",
        )
    finally:
        if conn:
            conn.close()


# ──────────────────────────────────────────────────────────────────
# n8n Orchestration Endpoint: Sync Instagram Data + Auto-Retrain
# ──────────────────────────────────────────────────────────────────
def _fetch_ig_profile(ig_id: str, token: str) -> Optional[int]:
    url = f"https://graph.facebook.com/v25.0/{ig_id}"
    params = {"fields": "followers_count", "access_token": token}
    with httpx.Client(timeout=15.0) as client:
        r = client.get(url, params=params)
        r.raise_for_status()
        followers = r.json().get("followers_count")
        return int(followers) if isinstance(followers, (int, float)) and followers >= 0 else None

def _validate_instagram_sync_post_limit(value: Any) -> int:
    """Validate the operator-controlled historical media cap.

    A finite upper bound prevents one workflow execution from walking an
    unexpectedly large account history and exhausting Meta/API resources.
    """
    try:
        limit = int(str(value).strip())
    except (TypeError, ValueError) as exc:
        raise ValueError("IG_SYNC_POST_LIMIT must be an integer") from exc
    if not 1 <= limit <= MAX_INSTAGRAM_SYNC_POST_LIMIT:
        raise ValueError(
            "IG_SYNC_POST_LIMIT must be between 1 and "
            f"{MAX_INSTAGRAM_SYNC_POST_LIMIT}"
        )
    return limit


def _instagram_sync_post_limit() -> int:
    return _validate_instagram_sync_post_limit(
        os.getenv("IG_SYNC_POST_LIMIT", str(DEFAULT_INSTAGRAM_SYNC_POST_LIMIT))
    )


def _fetch_ig_posts(
    ig_id: str,
    token: str,
    limit: Optional[int] = None,
) -> tuple[list, bool]:
    """Fetch bounded history and report whether the cap actually truncated it."""
    resolved_limit = _instagram_sync_post_limit() if limit is None else (
        _validate_instagram_sync_post_limit(limit)
    )
    url = f"https://graph.facebook.com/v25.0/{ig_id}/media"
    base_params = {
        "fields": "caption,like_count,comments_count,media_type,media_product_type,timestamp",
        # Request bounded pages and follow Meta's opaque `next` URL until the
        # configured total is reached. Do not assume Meta accepts the total cap
        # as one page size.
        "limit": min(resolved_limit, INSTAGRAM_GRAPH_PAGE_SIZE),
        "access_token": token,
    }
    params = dict(base_params)
    posts = []
    history_truncated_by_limit = False
    with httpx.Client(timeout=30.0) as client:
        while url and len(posts) < resolved_limit:
            r = client.get(url, params=params)
            r.raise_for_status()
            res = r.json()
            if not isinstance(res, dict):
                raise ValueError("Instagram media response must be a JSON object")
            page = res.get("data", [])
            if not isinstance(page, list):
                raise ValueError("Instagram media response data must be a JSON array")
            posts.extend(page)
            paging = res.get("paging", {})
            if not isinstance(paging, dict):
                raise ValueError("Instagram media response paging must be a JSON object")
            next_url = paging.get("next")
            after = (paging.get("cursors") or {}).get("after")
            if not after and next_url:
                # Some Graph responses include the cursor only in `next`.
                # Recover it without trusting that URL to retain credentials.
                after_values = parse_qs(urlparse(str(next_url)).query).get("after")
                after = after_values[-1] if after_values else None
            has_next_page = bool(next_url or after)
            if len(posts) >= resolved_limit:
                history_truncated_by_limit = has_next_page or (
                    len(posts) > resolved_limit
                )
                break
            if not page or not has_next_page:
                break
            if not after:
                raise ValueError(
                    "Instagram pagination advertised another page without a usable cursor"
                )
            # Always call the known endpoint with the original fields/token and
            # the opaque cursor. Meta's `next` URL is not assumed to retain auth.
            params = {**base_params, "after": str(after)}
    return posts[:resolved_limit], history_truncated_by_limit

def _get_brands_config() -> list[Dict[str, Any]]:
    """
    Instagram-connected brands configured through ``IG_BRANDS_JSON``.

    Every credential set must include the immutable database ``brand_id``.
    Name-based resolution is intentionally unsupported because two users can
    create brands with the same display name.
    """
    raw = os.getenv("IG_BRANDS_JSON")
    if not raw:
        return []

    try:
        entries = json.loads(raw)
        if not isinstance(entries, list):
            raise TypeError("expected a JSON array")

        normalized = []
        seen_brand_ids = set()
        seen_instagram_ids = set()
        for entry in entries:
            brand_id = str(entry["brand_id"])
            uuid.UUID(brand_id)
            instagram_id = str(entry["instagram_id"]).strip()
            access_token = str(entry["access_token"]).strip()
            if not instagram_id or not access_token:
                raise ValueError("instagram_id and access_token must be non-empty")
            if not re.fullmatch(r"[0-9]{5,64}", instagram_id):
                raise ValueError("instagram_id must be a numeric immutable account ID")
            if brand_id in seen_brand_ids:
                raise ValueError(f"duplicate brand_id: {brand_id}")
            if instagram_id in seen_instagram_ids:
                raise ValueError(f"duplicate instagram_id: {instagram_id}")
            seen_brand_ids.add(brand_id)
            seen_instagram_ids.add(instagram_id)
            normalized.append({
                "brand_id": brand_id,
                "instagram_id": instagram_id,
                "access_token": access_token,
            })
        return normalized
    except (ValueError, KeyError, TypeError) as exc:
        logger.error("IG_BRANDS_JSON is malformed: %s", exc)
        return []


def _bound_instagram_configs() -> list[Dict[str, Any]]:
    """Resolve configured credentials to existing database brands.

    This function never creates or claims a brand. Explicit UUID bindings are
    required. Unbound entries are returned with ``brand_id=None`` so health
    checks can report configuration problems without exposing the connection
    to a user-facing route.
    """
    configured = _get_brands_config()
    if not configured:
        return []

    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        return [{**entry, "brand_id": None, "binding_error": "DATABASE_URL is not configured"} for entry in configured]

    conn = None
    try:
        conn = psycopg2.connect(db_url)
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """SELECT id, name, niche, instagram_account_id
                   FROM brands WHERE owner_id IS NOT NULL"""
            )
            brands = [dict(row) for row in cur.fetchall()]
    except Exception as exc:
        logger.warning(f"Instagram configuration binding failed: {exc}")
        return [{**entry, "brand_id": None, "binding_error": "Database lookup failed"} for entry in configured]
    finally:
        if conn:
            conn.close()

    by_id = {str(brand["id"]): brand for brand in brands}
    bound = []
    for entry in configured:
        configured_id = str(entry.get("brand_id") or "")
        brand = by_id.get(configured_id) if configured_id else None

        persisted_instagram_id = (
            str(brand.get("instagram_account_id") or "") if brand else ""
        )
        if brand and persisted_instagram_id and persisted_instagram_id != entry["instagram_id"]:
            bound.append({
                **entry,
                "brand_id": None,
                "name": str(brand["name"]),
                "niche": str(brand["niche"]),
                "binding_error": (
                    "Configured instagram_id does not match this brand's persistent "
                    "Instagram account binding."
                ),
            })
        elif brand:
            bound.append({
                **entry,
                "brand_id": str(brand["id"]),
                "name": str(brand["name"]),
                "niche": str(brand["niche"]),
                "binding_error": None,
            })
        else:
            bound.append({**entry, "brand_id": None, "binding_error": "Configured brand_id does not exist"})
    return bound


def _get_instagram_connection(brand_id: str) -> Dict[str, Any]:
    matches = [entry for entry in _bound_instagram_configs() if entry.get("brand_id") == brand_id]
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        raise HTTPException(status_code=503, detail="Multiple Instagram connections target this brand. Fix IG_BRANDS_JSON.")
    raise HTTPException(status_code=404, detail="No Instagram connection is configured for this brand.")


def _parse_instagram_health_brand_ids(raw_brand_ids: Optional[str]) -> Optional[set[str]]:
    """Parse the BFF's comma-separated tenant scope.

    ``None`` is intentionally distinct from an empty string: an omitted query
    parameter is reserved for trusted operator diagnostics across configured
    connections, while ``brand_ids=`` is a valid user scope containing no
    brands. User-facing proxies must always send the parameter.
    """
    if raw_brand_ids is None:
        return None

    values = [value.strip() for value in raw_brand_ids.split(",") if value.strip()]
    if len(values) > MAX_INSTAGRAM_HEALTH_BRANDS:
        raise HTTPException(
            status_code=422,
            detail=f"At most {MAX_INSTAGRAM_HEALTH_BRANDS} brand_ids may be checked at once.",
        )

    parsed: set[str] = set()
    for value in values:
        try:
            parsed.add(str(uuid.UUID(value)))
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="brand_ids must contain valid UUIDs.") from exc
    return parsed


@app.get("/instagram/health", dependencies=[Depends(verify_internal_token)])
def instagram_health(brand_ids: Optional[str] = None):
    """
    Connection health for explicitly scoped Instagram-linked brands.

    User-facing BFFs must always pass ``brand_ids`` (including an empty value)
    so unrelated tenants are excluded before database and Graph API calls. An
    omitted parameter retains all-connection diagnostics for trusted operators
    calling this internal-token-protected service directly.
    """
    requested_brand_ids = _parse_instagram_health_brand_ids(brand_ids)
    configs = _bound_instagram_configs()
    if requested_brand_ids is not None:
        configs = [
            config
            for config in configs
            if config.get("brand_id") in requested_brand_ids
        ]

    connections = []
    last_synced: Dict[str, Optional[str]] = {}
    bound_brand_ids = [str(config["brand_id"]) for config in configs if config.get("brand_id")]
    db_url = os.getenv("DATABASE_URL")
    if db_url and bound_brand_ids:
        conn = None
        try:
            conn = psycopg2.connect(db_url)
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT b.id, MAX(p.synced_at)
                       FROM brands b
                       LEFT JOIN posts p
                         ON p.brand_id = b.id
                        AND p.source = 'instagram_graph'
                        AND p.instagram_media_id IS NOT NULL
                       WHERE b.id = ANY(%s::uuid[])
                       GROUP BY b.id""",
                    (bound_brand_ids,),
                )
                for brand_id, ts in cur.fetchall():
                    last_synced[str(brand_id)] = ts.isoformat() if ts else None
        except Exception as e:
            logger.warning(f"Instagram health: last-sync lookup failed: {e}")
        finally:
            if conn:
                conn.close()

    for config in configs:
        brand_id = config.get("brand_id")
        entry: Dict[str, Any] = {
            "brand_id": brand_id,
            "brand": config.get("name") or "Unbound connection",
            "niche": config.get("niche"),
            "last_synced": last_synced.get(str(brand_id)) if brand_id else None,
        }
        if not brand_id:
            entry.update({"status": "unbound", "error": config.get("binding_error")})
            connections.append(entry)
            continue
        try:
            with httpx.Client(timeout=10.0) as client:
                r = client.get(
                    f"https://graph.facebook.com/v25.0/{config['instagram_id']}",
                    params={"fields": "username,followers_count", "access_token": config["access_token"]},
                )
            if r.status_code == 200:
                data = r.json()
                entry.update({
                    "status": "connected",
                    "username": data.get("username"),
                    "followers": data.get("followers_count"),
                })
            else:
                detail = r.json().get("error", {}).get("message", r.text[:200])
                entry.update({"status": "error", "error": detail})
        except Exception:
            logger.exception("Instagram health check failed for brand %s", brand_id)
            entry.update({
                "status": "unreachable",
                "error": "Instagram Graph API could not be reached.",
            })
        connections.append(entry)

    return {"status": "success", "connections": connections}


@app.get("/brand/patterns", dependencies=[Depends(verify_internal_token)])
def brand_patterns(brand_id: str):
    """Descriptive, brand-only planning evidence from verified mature posts.

    The authenticated Next.js BFF remains responsible for user/brand ownership
    checks. This internal endpoint additionally refuses unowned brands and
    returns aggregate evidence only—never captions or Instagram media IDs.
    """
    try:
        normalized_brand_id = str(uuid.UUID(brand_id))
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail="brand_id must be a valid UUID.") from exc

    conn = None
    try:
        conn = get_db_connection()
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """SELECT id, name, niche
                   FROM brands
                   WHERE id = %s AND owner_id IS NOT NULL
                   LIMIT 1""",
                (normalized_brand_id,),
            )
            brand = cur.fetchone()
            if not brand:
                raise HTTPException(status_code=404, detail="Brand was not found.")

            cur.execute(
                """SELECT caption, er, is_single_image, is_carousel, is_reels,
                          media_product_type, post_hour, caption_length,
                          hashtag_count, has_cta, created_at, synced_at
                   FROM posts
                   WHERE brand_id = %s
                     AND source = 'instagram_graph'
                     AND instagram_media_id IS NOT NULL
                     AND er IS NOT NULL
                     AND post_hour IS NOT NULL
                     AND created_at IS NOT NULL
                     AND created_at <= now() - (%s * interval '1 day')
                   ORDER BY created_at ASC, instagram_media_id ASC""",
                (normalized_brand_id, MIN_POST_AGE_DAYS),
            )
            rows = [dict(row) for row in cur.fetchall()]
        return build_brand_patterns(
            rows,
            brand_id=normalized_brand_id,
            brand_name=str(brand["name"]),
            niche=str(brand["niche"]),
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("Brand pattern lookup failed for brand %s", normalized_brand_id)
        raise HTTPException(
            status_code=503,
            detail="Brand performance patterns are temporarily unavailable.",
        )
    finally:
        if conn:
            conn.close()


@app.get("/instagram/posts", dependencies=[Depends(verify_internal_token)])
def instagram_posts(brand_id: str, limit: int = 24):
    """
    Live post insights for a linked brand: media previews, engagement
    metrics, and an ER tier graded against the brand's own synced history
    (same percentile method as training labels). Media URLs are fetched
    fresh on every call because Instagram CDN URLs expire.
    """
    config = _get_instagram_connection(brand_id)
    brand = config["name"]
    ig_id = config["instagram_id"]
    token = config["access_token"]
    followers = None
    media: list[Dict[str, Any]] = []
    live_available = True
    graph_failure_code = None
    try:
        followers = _fetch_ig_profile(ig_id, token)
        params = {
            "fields": "caption,like_count,comments_count,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp",
            "limit": min(max(limit, 1), 50),
            "access_token": token,
        }
        with httpx.Client(timeout=30.0) as client:
            r = client.get(f"https://graph.facebook.com/v25.0/{ig_id}/media", params=params)
            r.raise_for_status()
            media = r.json().get("data", [])
    except httpx.HTTPStatusError as e:
        live_available = False
        graph_failure_code = "graph_api_rejected_request"
        logger.warning(
            "Instagram live posts unavailable for brand %s: Graph HTTP %s",
            brand_id,
            e.response.status_code,
        )
    except Exception as exc:
        live_available = False
        graph_failure_code = "graph_api_unreachable"
        logger.warning(
            "Instagram live posts unavailable for brand %s: %s",
            brand_id,
            type(exc).__name__,
        )

    p33 = p67 = None
    synced_by_media: Dict[str, Dict[str, Any]] = {}
    stored_fallback_media: list[Dict[str, Any]] = []
    db_url = os.getenv("DATABASE_URL")
    if db_url:
        conn = None
        try:
            conn = psycopg2.connect(db_url)
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT p.id::text, p.instagram_media_id, p.er, p.synced_at,
                              (
                                p.created_at IS NOT NULL
                                AND p.created_at <= now() - (%s * interval '1 day')
                              ) AS is_mature,
                              (
                                p.is_single_image
                                OR p.is_carousel
                                OR (p.is_reels AND p.media_product_type = 'REELS')
                              ) AS is_modeled_format,
                              (p.post_hour IS NOT NULL) AS has_complete_features
                       FROM posts p
                       WHERE p.brand_id = %s
                         AND p.source = 'instagram_graph'
                         AND p.instagram_media_id IS NOT NULL""",
                    (MIN_POST_AGE_DAYS, brand_id),
                )
                for (
                    media_id,
                    instagram_media_id,
                    er,
                    synced_at,
                    is_mature,
                    is_modeled_format,
                    has_complete_features,
                ) in cur.fetchall():
                    numeric_er = float(er) if er is not None else None
                    comparison = _post_comparison_status(
                        has_sync=True,
                        er=numeric_er,
                        is_mature=bool(is_mature),
                        is_modeled_format=bool(is_modeled_format),
                        has_complete_features=bool(has_complete_features),
                    )
                    synced_by_media[str(instagram_media_id)] = {
                        "post_id": str(media_id),
                        "er": numeric_er,
                        "synced_at": synced_at.isoformat() if synced_at else None,
                        "comparison": comparison,
                    }
                cur.execute(
                    """SELECT percentile_cont(0.33) WITHIN GROUP (ORDER BY p.er),
                              percentile_cont(0.67) WITHIN GROUP (ORDER BY p.er)
                       FROM posts p
                       WHERE p.brand_id = %s
                         AND p.source = 'instagram_graph'
                         AND p.instagram_media_id IS NOT NULL
                         AND p.er IS NOT NULL
                         AND p.post_hour IS NOT NULL
                         AND p.created_at IS NOT NULL
                         AND p.created_at <= now() - (%s * interval '1 day')
                         AND (
                           p.is_single_image
                           OR p.is_carousel
                           OR (p.is_reels AND p.media_product_type = 'REELS')
                         )""",
                    (brand_id, MIN_POST_AGE_DAYS),
                )
                row = cur.fetchone()
                if row and row[0] is not None:
                    p33, p67 = float(row[0]), float(row[1])
                if not live_available:
                    cur.execute(
                        """SELECT p.id::text, p.instagram_media_id, p.caption,
                                  p.media_product_type, p.is_single_image,
                                  p.is_carousel, p.is_reels, p.created_at,
                                  b.followers
                           FROM posts p
                           JOIN brands b ON b.id = p.brand_id
                           WHERE p.brand_id = %s
                             AND p.source = 'instagram_graph'
                             AND p.instagram_media_id IS NOT NULL
                           ORDER BY p.created_at DESC, p.instagram_media_id DESC
                           LIMIT %s""",
                        (brand_id, min(max(limit, 1), 50)),
                    )
                    for (
                        post_id,
                        media_id,
                        caption,
                        media_product_type,
                        is_single_image,
                        is_carousel,
                        is_reels,
                        created_at,
                        stored_followers,
                    ) in cur.fetchall():
                        if followers is None and stored_followers is not None:
                            followers = int(stored_followers)
                        media_type = (
                            "IMAGE" if is_single_image
                            else "CAROUSEL_ALBUM" if is_carousel
                            else "VIDEO" if is_reels or media_product_type in {"FEED", "REELS"}
                            else None
                        )
                        stored_fallback_media.append({
                            "post_id": str(post_id),
                            "id": str(media_id),
                            "caption": caption or "",
                            "media_type": media_type,
                            "media_product_type": media_product_type,
                            "timestamp": created_at.isoformat() if created_at else None,
                            "_stored_only": True,
                        })
        except Exception as e:
            logger.warning(f"Post insights: percentile lookup failed: {e}")
        finally:
            if conn:
                conn.close()

    if not live_available:
        if not stored_fallback_media:
            raise HTTPException(
                status_code=502,
                detail="Instagram Graph API is unavailable and no stored verified history exists.",
            )
        media = stored_fallback_media

    posts = []
    for m in media:
        likes = m.get("like_count") if isinstance(m.get("like_count"), (int, float)) else None
        comments = m.get("comments_count") if isinstance(m.get("comments_count"), (int, float)) else None
        # Never rebase historical engagement onto today's follower count. The
        # stored ER preserves the follower snapshot captured by the verified
        # Instagram sync; media that has not been synced remains unavailable.
        synced = synced_by_media.get(str(m.get("id")))
        er = synced.get("er") if synced else None
        comparison = (
            synced.get("comparison")
            if synced
            else _post_comparison_status(
                has_sync=False,
                er=None,
                is_mature=False,
                is_modeled_format=False,
                has_complete_features=False,
            )
        )
        tier = None
        if p33 is not None and er is not None and comparison["eligible"]:
            tier = "Low" if er < p33 else ("Average" if er <= p67 else "High")
        posts.append({
            "post_id": m.get("post_id") or (synced.get("post_id") if synced else None),
            "id": m.get("id"),
            "caption": m.get("caption", ""),
            "media_type": m.get("media_type"),
            "media_product_type": m.get("media_product_type"),
            "media_url": m.get("media_url"),
            "thumbnail_url": m.get("thumbnail_url"),
            "permalink": m.get("permalink"),
            "timestamp": m.get("timestamp"),
            "likes": likes,
            "comments": comments,
            "er": er,
            "tier": tier,
            "comparison_eligible": comparison["eligible"],
            "comparison_unavailable_code": comparison["reason_code"],
            "comparison_unavailable_reason": comparison["reason"],
            "synced_at": synced.get("synced_at") if synced else None,
        })
    return {
        "status": "success" if live_available else "degraded",
        "brand_id": brand_id,
        "brand": brand,
        "followers": followers,
        "posts": posts,
        "provenance": {
            "live_source": "instagram_graph_api" if live_available else None,
            "synced_source": "production_database_instagram_graph_sync",
            "stored_only": not live_available,
            "degraded_reason_code": graph_failure_code,
            "fetched_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "post_limit": min(max(limit, 1), 50),
        },
    }


def _media_insight_value(payload: Dict[str, Any]) -> Optional[float]:
    data = payload.get("data") or []
    if not data:
        return None
    item = data[0]
    total = item.get("total_value") or {}
    if isinstance(total.get("value"), (int, float)):
        return float(total["value"])
    values = item.get("values") or []
    if values and isinstance(values[0].get("value"), (int, float)):
        return float(values[0]["value"])
    return None


def _media_insight_values(payload: Dict[str, Any]) -> Dict[str, float]:
    """Normalize Meta's lifetime insight response for one or many metrics."""
    result: Dict[str, float] = {}
    for item in payload.get("data") or []:
        name = item.get("name")
        if not isinstance(name, str):
            continue
        value = _media_insight_value({"data": [item]})
        if value is not None:
            result[name] = value
    return result


def _post_comparison_status(
    *,
    has_sync: bool,
    er: Optional[float],
    is_mature: bool,
    is_modeled_format: bool,
    has_complete_features: bool,
) -> Dict[str, Any]:
    """Return a stable eligibility flag and an honest unavailable reason."""
    reason_code = None
    if not has_sync or er is None:
        reason_code = "not_synced"
    elif not is_mature:
        reason_code = "immature"
    elif not is_modeled_format:
        reason_code = "unmodeled_format"
    elif not has_complete_features:
        reason_code = "incomplete_features"
    return {
        "eligible": reason_code is None,
        "reason_code": reason_code,
        "reason": (
            POST_COMPARISON_UNAVAILABLE_REASONS[reason_code]
            if reason_code is not None
            else None
        ),
    }


def _prediction_detail_payload(
    match: Dict[str, Any],
    *,
    match_method: str,
) -> Dict[str, Any]:
    return {
        "id": str(match["id"]),
        "tier": str(match["pred_class"]).title(),
        "actual_er": (
            float(match["actual_er"])
            if match.get("actual_source") == "instagram_media_id"
            and match.get("actual_er") is not None
            else None
        ),
        # A tier is deliberately not synthesized from a moving post
        # population; continuous ER is the defensible observed outcome.
        "actual_tier": None,
        "confidence": (
            float(match["confidence"]) if match.get("confidence") else None
        ),
        "model_version": match.get("model_version"),
        "match_method": match_method,
        "publication_linked": bool(match.get("publication_linked")),
        "publication_matches_selected_media": bool(
            match.get("publication_matches_selected_media")
        ),
    }


@app.post("/instagram/post-insights", dependencies=[Depends(verify_internal_token)])
def instagram_post_insights(req: InstagramPostInsightsRequest):
    """Fetch supported lifetime metrics for one selected Instagram post.

    Meta exposes different metrics by media type and API version. We request
    the common media metrics in one call, then fall back to individual calls
    only if Meta rejects the mixed set. Unsupported metrics never become zero.
    """
    config = _get_instagram_connection(req.brand_id)
    token = config["access_token"]

    requested_metrics = [
        "reach", "impressions", "views", "saved", "shares",
        "total_interactions", "accounts_engaged",
    ]
    metrics: Dict[str, float] = {}
    unavailable = []
    insights_url = f"https://graph.facebook.com/v25.0/{req.media_id}/insights"
    with httpx.Client(timeout=15.0) as client:
        ownership = client.get(
            f"https://graph.facebook.com/v25.0/{req.media_id}",
            params={"fields": "id,owner,caption", "access_token": token},
        )
        if ownership.status_code != 200:
            raise HTTPException(status_code=404, detail="Instagram media was not found for this connection.")
        verified_media = ownership.json()
        owner_id = str((verified_media.get("owner") or {}).get("id") or "")
        if owner_id != str(config["instagram_id"]):
            raise HTTPException(status_code=404, detail="Instagram media does not belong to this brand.")
        verified_caption = verified_media.get("caption")

        try:
            combined = client.get(
                insights_url,
                params={"metric": ",".join(requested_metrics), "period": "lifetime", "access_token": token},
            )
            if combined.status_code == 200:
                metrics.update(_media_insight_values(combined.json()))
        except Exception:
            pass

        missing = [metric for metric in requested_metrics if metric not in metrics]
        # A mixed query can fail when one metric is unavailable for this media
        # type. Retry only the missing metrics to preserve the supported subset.
        for metric in missing:
            try:
                response = client.get(
                    insights_url,
                    params={"metric": metric, "period": "lifetime", "access_token": token},
                )
                if response.status_code != 200:
                    unavailable.append(metric)
                    continue
                value = _media_insight_value(response.json())
                if value is None:
                    unavailable.append(metric)
                else:
                    metrics[metric] = value
            except Exception:
                unavailable.append(metric)

    historical: Dict[str, Any] = {
        "brand_median_er": None,
        "brand_baseline_posts": 0,
        "brand_baseline_unavailable_reason": None,
        "comparison_eligible": False,
        "comparison_unavailable_code": "not_synced",
        "comparison_unavailable_reason": POST_COMPARISON_UNAVAILABLE_REASONS["not_synced"],
        "verified_post_id": None,
        "recent_performance": {
            "available": False,
            "reason_code": "fixed_horizon_snapshots_unavailable",
            "reason": RECENT_PERFORMANCE_UNAVAILABLE_REASON,
        },
    }
    prediction = None
    prediction_match_status = "not_found"
    db_url = os.getenv("DATABASE_URL")
    if db_url:
        conn = None
        try:
            conn = psycopg2.connect(db_url)
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """SELECT p.id::text AS post_id, p.er,
                              (
                                p.created_at IS NOT NULL
                                AND p.created_at <= now() - (%s * interval '1 day')
                              ) AS is_mature,
                              (
                                p.is_single_image
                                OR p.is_carousel
                                OR (p.is_reels AND p.media_product_type = 'REELS')
                              ) AS is_modeled_format,
                              (p.post_hour IS NOT NULL) AS has_complete_features
                       FROM posts p
                       WHERE p.brand_id = %s
                         AND p.source = 'instagram_graph'
                         AND p.instagram_media_id = %s
                       LIMIT 1""",
                    (MIN_POST_AGE_DAYS, req.brand_id, req.media_id),
                )
                selected_row = cur.fetchone()
                if selected_row:
                    historical["verified_post_id"] = selected_row.get("post_id")
                    selected_er = (
                        float(selected_row["er"])
                        if selected_row.get("er") is not None
                        else None
                    )
                    comparison = _post_comparison_status(
                        has_sync=True,
                        er=selected_er,
                        is_mature=bool(selected_row.get("is_mature")),
                        is_modeled_format=bool(selected_row.get("is_modeled_format")),
                        has_complete_features=bool(selected_row.get("has_complete_features")),
                    )
                    historical["comparison_eligible"] = comparison["eligible"]
                    historical["comparison_unavailable_code"] = comparison["reason_code"]
                    historical["comparison_unavailable_reason"] = comparison["reason"]

                    if comparison["eligible"]:
                        cur.execute(
                            """SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY p.er) AS brand_median_er,
                                      count(*) AS brand_baseline_posts
                               FROM posts p
                               WHERE p.brand_id = %s
                                 AND p.source = 'instagram_graph'
                                 AND p.instagram_media_id IS NOT NULL
                                 AND p.instagram_media_id <> %s
                                 AND p.er IS NOT NULL
                                 AND p.post_hour IS NOT NULL
                                 AND p.created_at IS NOT NULL
                                 AND p.created_at <= now() - (%s * interval '1 day')
                                 AND (
                                   p.is_single_image
                                   OR p.is_carousel
                                   OR (p.is_reels AND p.media_product_type = 'REELS')
                                 )""",
                            (req.brand_id, req.media_id, MIN_POST_AGE_DAYS),
                        )
                        baseline_row = cur.fetchone()
                        if baseline_row:
                            historical["brand_baseline_posts"] = int(
                                baseline_row.get("brand_baseline_posts") or 0
                            )
                            if baseline_row.get("brand_median_er") is not None:
                                historical["brand_median_er"] = float(
                                    baseline_row["brand_median_er"]
                                )
                            else:
                                historical["brand_baseline_unavailable_reason"] = (
                                    "No other mature, model-eligible posts are available "
                                    "for a brand-history baseline."
                                )

                # An immutable publication link wins over mutable caption text.
                # This remains resolvable after a caption edit or deletion.
                cur.execute(
                    """SELECT p.id::text AS id, p.pred_class, p.actual_er,
                              p.actual_source, p.model_version,
                              p.features->>'confidence' AS confidence,
                              true AS publication_linked,
                              true AS publication_matches_selected_media
                       FROM prediction_publications publication
                       JOIN predictions p ON p.id = publication.prediction_id
                       WHERE publication.brand_id = %s
                         AND publication.instagram_media_id = %s
                         AND publication.owner_id = %s
                         AND p.created_by = %s
                       LIMIT 1""",
                    (req.brand_id, req.media_id, req.created_by, req.created_by),
                )
                linked_match = cur.fetchone()
                if linked_match:
                    prediction_match_status = "verified_publication_link"
                    prediction = _prediction_detail_payload(
                        linked_match,
                        match_method="verified_media_id",
                    )

                if prediction is None and isinstance(verified_caption, str) and verified_caption.strip():
                    normalized = re.sub(r"\s+", " ", verified_caption.strip().lower())
                    cur.execute(
                        """SELECT p.id::text AS id, p.pred_class, p.actual_er,
                                  p.actual_source, p.model_version,
                                  p.features->>'confidence' AS confidence,
                                  EXISTS (
                                    SELECT 1 FROM prediction_publications publication
                                    WHERE publication.prediction_id = p.id
                                  ) AS publication_linked,
                                  EXISTS (
                                    SELECT 1 FROM prediction_publications publication
                                    WHERE publication.prediction_id = p.id
                                      AND publication.instagram_media_id = %s
                                  ) AS publication_matches_selected_media
                           FROM predictions p
                           WHERE p.brand_id = %s AND p.created_by = %s
                             AND regexp_replace(lower(trim(coalesce(p.caption, ''))), '\\s+', ' ', 'g') = %s
                           ORDER BY p.created_at DESC LIMIT 2""",
                        (req.media_id, req.brand_id, req.created_by, normalized),
                    )
                    matches = cur.fetchall()
                    if len(matches) == 1:
                        match = matches[0]
                        prediction_match_status = "unique_verified_caption"
                        prediction = _prediction_detail_payload(
                            match,
                            match_method="verified_graph_caption_candidate",
                        )
                    elif len(matches) > 1:
                        prediction_match_status = "ambiguous_duplicate_caption"
        except Exception as exc:
            logger.warning(f"Post detail comparison lookup failed: {exc}")
            historical["comparison_eligible"] = False
            historical["comparison_unavailable_code"] = "lookup_unavailable"
            historical["comparison_unavailable_reason"] = (
                POST_COMPARISON_UNAVAILABLE_REASONS["lookup_unavailable"]
            )
        finally:
            if conn:
                conn.close()

    return {
        "status": "success",
        "metrics": metrics,
        "unavailable_metrics": sorted(set(unavailable)),
        # Meta's media-insights endpoint does not reliably attribute these
        # account-level actions to an individual organic post.
        "not_attributable_metrics": ["profile_visits", "follows"],
        "historical": historical,
        "prediction": prediction,
        "prediction_match_status": prediction_match_status,
        "provenance": {
            "live_source": "instagram_graph_api",
            "historical_source": "production_database_instagram_graph_sync",
            "prediction_source": "authenticated_user_prediction_history",
            "fetched_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        },
    }


def _normalized_media_product_type(post: Dict[str, Any]) -> str:
    """Return a constrained Meta product type without guessing future values."""
    value = str(post.get("media_product_type") or "").strip().upper()
    return value if value in KNOWN_INSTAGRAM_PRODUCT_TYPES else "UNKNOWN"


def _model_format_for_media(media_type: str, product_type: str) -> Optional[str]:
    """Map Graph media to the three formats supported by the trained model.

    ``media_type=VIDEO`` is not enough to identify a Reel: Meta also reports
    feed video as VIDEO. Only the explicit REELS product classification may set
    the Reels feature. Stories, ads, feed videos, and unknown videos are stored
    for descriptive history but excluded from model training.
    """
    if product_type in {"STORY", "AD"}:
        return None
    if media_type == "IMAGE":
        return "Single Image"
    if media_type == "CAROUSEL_ALBUM":
        return "Carousel"
    if media_type == "VIDEO" and product_type == "REELS":
        return "Reels"
    return None


def _bind_instagram_identity(
    cur,
    *,
    brand_id: str,
    instagram_account_id: str,
    followers: int,
) -> None:
    """Atomically establish or verify a brand's immutable Graph identity."""
    try:
        cur.execute(
            """UPDATE brands
               SET followers = %s,
                   instagram_account_id = COALESCE(instagram_account_id, %s)
               WHERE id = %s
                 AND owner_id IS NOT NULL
                 AND (
                   instagram_account_id IS NULL
                   OR instagram_account_id = %s
                 )
               RETURNING instagram_account_id""",
            (followers, instagram_account_id, brand_id, instagram_account_id),
        )
    except psycopg2.IntegrityError as exc:
        raise InstagramIdentityBindingError(
            "This Instagram account is already bound to another brand."
        ) from exc
    if cur.fetchone() is None:
        raise InstagramIdentityBindingError(
            "Configured Instagram account does not match the brand's persistent binding."
        )


def _reconcile_prediction_publications(cur, brand_id: str) -> int:
    """Refresh mature continuous outcomes; the DB function enforces provenance."""
    cur.execute(
        "SELECT public.reconcile_prediction_publication_outcomes(%s::uuid)",
        (brand_id,),
    )
    row = cur.fetchone()
    if not row:
        return 0
    if isinstance(row, dict):
        value = next(iter(row.values()), 0)
    else:
        value = row[0]
    return int(value or 0)


def _upsert_instagram_media(cur, brand_id: str, post: Dict[str, Any], current_followers: int) -> str:
    """Insert or refresh one Graph API media row without deleting history.

    The immutable Instagram media ID is the identity key. On the first run
    after migration, one legacy row may be claimed only when both timestamp
    and caption match exactly. The first observed follower denominator is
    preserved; for posts imported long after publication this is an explicit
    proxy, not a historical follower-at-publication measurement.
    """
    media_id = str(post["id"])
    caption = post.get("caption") or ""
    timestamp = str(post["timestamp"])
    likes = float(post["like_count"])
    comments = float(post["comments_count"])
    media_type = post.get("media_type", "IMAGE")
    if media_type not in SUPPORTED_INSTAGRAM_MEDIA_TYPES:
        raise ValueError(f"Unsupported Instagram media type: {media_type!r}")
    media_product_type = _normalized_media_product_type(post)
    ts_clean = timestamp.replace("Z", "+00:00").replace("+0000", "+00:00")
    dt_utc = datetime.datetime.fromisoformat(ts_clean)
    dt_wib = dt_utc + datetime.timedelta(hours=7)
    post_hour = dt_wib.hour
    format_type = _model_format_for_media(media_type, media_product_type)
    # The synchronization path and prediction path share the same authoritative
    # extractor. This prevents a model from being trained on feature semantics
    # that differ from the values used during inference.
    extracted = DataPreprocessor.extract_features(
        caption=caption,
        format_type=format_type or "Unsupported",
        post_hour=post_hour,
        is_weekend=dt_wib.weekday() >= 5,
    )

    cur.execute(
        """SELECT id, follower_count_at_post FROM posts
           WHERE brand_id = %s AND instagram_media_id = %s
           LIMIT 1""",
        (brand_id, media_id),
    )
    existing = cur.fetchone()
    result = "updated"
    if not existing:
        cur.execute(
            """SELECT id, follower_count_at_post FROM posts
               WHERE brand_id = %s
                 AND instagram_media_id IS NULL
                 AND source IS NULL
                 AND created_at = %s
                 AND caption IS NOT DISTINCT FROM %s
               ORDER BY id LIMIT 1""",
            (brand_id, timestamp, caption),
        )
        existing = cur.fetchone()
        result = "claimed" if existing else "inserted"

    denominator = (
        int(existing[1])
        if existing and isinstance(existing[1], (int, float)) and existing[1] > 0
        else current_followers
    )
    er = round(((likes + comments) / denominator) * 100, 4)
    values = (
        media_id, media_product_type, caption, er, denominator,
        bool(extracted["is_single_image"]),
        bool(extracted["is_carousel"]),
        bool(extracted["is_reels"]),
        int(extracted["post_hour"]),
        int(extracted["caption_length"]),
        int(extracted["hashtag_count"]),
        bool(extracted["has_cta"]),
        timestamp,
    )

    if existing:
        cur.execute(
            """UPDATE posts SET
                 instagram_media_id = %s, source = 'instagram_graph',
                 media_product_type = %s, caption = %s, er = %s, is_synced = true,
                 follower_count_at_post = %s,
                 is_single_image = %s, is_carousel = %s, is_reels = %s,
                 post_hour = %s, caption_length = %s, hashtag_count = %s,
                 has_cta = %s, created_at = %s,
                 synced_at = timezone('utc'::text, now())
               WHERE id = %s""",
            (*values, existing[0]),
        )
    else:
        cur.execute(
            """INSERT INTO posts (
                 brand_id, instagram_media_id, media_product_type, source, caption, er, is_synced,
                 follower_count_at_post, is_single_image, is_carousel, is_reels,
                 post_hour, caption_length, hashtag_count, has_cta, created_at, synced_at
               ) VALUES (
                 %s, %s, %s, 'instagram_graph', %s, %s, true,
                 %s, %s, %s, %s, %s, %s, %s, %s, %s,
                 timezone('utc'::text, now())
               )""",
            (brand_id, *values),
        )
    return result


def _sync_and_retrain_pipeline():
    """Sync configured Instagram accounts and train the appropriate model.

    Connections must already be bound to an existing brand; sync never creates
    user-facing rows. Accounts with at least 200 eligible, mature posts train a
    personal model. Smaller accounts contribute to one shared cohort model per run.
    """
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        return {"status": "error", "message": "DATABASE_URL not configured"}

    try:
        post_limit = _instagram_sync_post_limit()
    except ValueError as exc:
        return {
            "status": "error",
            "message": str(exc),
            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "results": [],
        }

    brands_config = _bound_instagram_configs()
    if not brands_config:
        return {
            "status": "error",
            "message": "No Instagram connections are configured.",
            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "results": [],
        }
    results = []

    for config in brands_config:
        name = config.get("name") or "Unbound connection"
        niche = config.get("niche")
        brand_id = config.get("brand_id")
        brand_result = {"brand": name, "niche": niche, "sync": {}, "train": {}}
        if not brand_id:
            brand_result["sync"] = {
                "status": "failed",
                "error": config.get("binding_error") or "Instagram connection is not bound to a brand",
            }
            results.append(brand_result)
            continue

        conn = None
        try:
            followers = _fetch_ig_profile(config["instagram_id"], config["access_token"])
            brand_result["sync"]["followers"] = followers
            if not followers or followers <= 0:
                raise ValueError(
                    "Instagram returned no usable follower denominator; refusing to write fabricated 0% engagement rates."
                )

            posts, history_truncated_by_limit = _fetch_ig_posts(
                config["instagram_id"],
                config["access_token"],
                limit=post_limit,
            )
            valid_posts = [
                post for post in posts
                if isinstance(post.get("like_count"), (int, float))
                and isinstance(post.get("comments_count"), (int, float))
                and post.get("id")
                and post.get("timestamp")
                and post.get("media_type") in SUPPORTED_INSTAGRAM_MEDIA_TYPES
            ]
            if not valid_posts:
                raise ValueError("Instagram returned no posts with complete supported media, engagement, and timestamp fields; existing history was preserved.")
            if len(valid_posts) != len(posts):
                logger.warning(f"Skipping {len(posts) - len(valid_posts)} incomplete Instagram media rows for {name}.")
            conn = psycopg2.connect(db_url)
            sync_counts = {"inserted": 0, "updated": 0, "claimed": 0}
            with conn.cursor() as cur:
                # This row lock serializes concurrent syncs for the same brand
                # until the media upserts commit. It also establishes the
                # immutable account binding on first verified synchronization.
                _bind_instagram_identity(
                    cur,
                    brand_id=brand_id,
                    instagram_account_id=str(config["instagram_id"]),
                    followers=followers,
                )
                for post in valid_posts:
                    sync_result = _upsert_instagram_media(cur, brand_id, post, followers)
                    sync_counts[sync_result] += 1
                reconciled_outcomes = _reconcile_prediction_publications(cur, brand_id)
                cur.execute(
                    """SELECT COUNT(*),
                              COUNT(*) FILTER (
                                WHERE er IS NOT NULL
                                  AND post_hour IS NOT NULL
                                  AND created_at IS NOT NULL
                                  AND created_at <= now() - (%s * interval '1 day')
                              ),
                              COUNT(*) FILTER (
                                WHERE er IS NOT NULL
                                  AND post_hour IS NOT NULL
                                  AND created_at IS NOT NULL
                                  AND created_at <= now() - (%s * interval '1 day')
                                  AND (
                                    is_single_image
                                    OR is_carousel
                                    OR (is_reels AND media_product_type = 'REELS')
                                  )
                              )
                       FROM posts
                       WHERE brand_id = %s
                         AND source = 'instagram_graph'
                         AND instagram_media_id IS NOT NULL""",
                    (MIN_POST_AGE_DAYS, MIN_POST_AGE_DAYS, brand_id),
                )
                stored_count, mature_history_count, mature_count = (
                    int(value) for value in cur.fetchone()
                )
            conn.commit()
            conn.close()
            conn = None
            brand_result["sync"]["posts_received"] = len(posts)
            brand_result["sync"]["configured_post_limit"] = post_limit
            brand_result["sync"]["history_truncated_by_limit"] = (
                history_truncated_by_limit
            )
            brand_result["sync"]["posts_synced"] = len(valid_posts)
            brand_result["sync"]["posts_inserted"] = sync_counts["inserted"]
            brand_result["sync"]["posts_updated"] = sync_counts["updated"]
            brand_result["sync"]["legacy_rows_claimed"] = sync_counts["claimed"]
            brand_result["sync"]["stored_verified_posts"] = stored_count
            brand_result["sync"]["mature_history_posts"] = mature_history_count
            brand_result["sync"]["mature_training_posts"] = mature_count
            brand_result["sync"]["excluded_unmodeled_mature_posts"] = (
                mature_history_count - mature_count
            )
            brand_result["sync"]["prediction_outcomes_reconciled"] = reconciled_outcomes
            brand_result["sync"]["status"] = "success"
            logger.info(
                f"[n8n Sync] {name}: {len(valid_posts)}/{len(posts)} posts synced "
                f"({sync_counts['inserted']} inserted, {sync_counts['updated']} updated, "
                f"{sync_counts['claimed']} legacy rows claimed)."
            )

            try:
                if mature_count >= MIN_ACCOUNT_TRAINING_SAMPLES:
                    train_scope = "personal"
                    train_result = ModelTrainer.run_training(brand_id=brand_id)
                else:
                    brand_result["train"] = {
                        "status": "pending",
                        "scope": "cohort",
                        "reason": "Cohort training runs after every configured brand has synced.",
                    }
                    results.append(brand_result)
                    continue
                brand_result["train"] = {
                    "status": "success",
                    "scope": train_scope,
                    "accuracy": train_result["metrics"]["accuracy"],
                    "f1_score": train_result["metrics"]["f1_score"],
                    "model_filename": train_result["model_filename"]
                }
                logger.info(f"[n8n Train] {name} ({train_scope}): accuracy={train_result['metrics']['accuracy']:.2%}")
            except Exception:
                logger.exception("Personal model training failed for brand %s", brand_id)
                brand_result["train"] = {
                    "status": "failed",
                    "error": "Model training failed. Inspect the ML service logs for the cause.",
                }

        except InstagramIdentityBindingError as exc:
            logger.error("Instagram identity binding rejected for brand %s", brand_id)
            brand_result["sync"]["status"] = "failed"
            brand_result["sync"]["error"] = str(exc)
        except httpx.HTTPStatusError as exc:
            logger.error(
                "Instagram synchronization failed for brand %s: Graph API HTTP %s",
                brand_id,
                exc.response.status_code,
            )
            brand_result["sync"]["status"] = "failed"
            brand_result["sync"]["error"] = (
                "Instagram Graph API rejected the synchronization request. "
                "Inspect the token and app permissions."
            )
        except httpx.RequestError as exc:
            logger.error(
                "Instagram synchronization failed for brand %s: Graph request %s",
                brand_id,
                type(exc).__name__,
            )
            brand_result["sync"]["status"] = "failed"
            brand_result["sync"]["error"] = (
                "Instagram Graph API request failed or timed out. Retry after "
                "checking connectivity."
            )
        except Exception:
            logger.exception("Instagram synchronization failed for brand %s", brand_id)
            brand_result["sync"]["status"] = "failed"
            brand_result["sync"]["error"] = (
                "Instagram synchronization failed. Inspect the ML service logs for the cause."
            )
        finally:
            if conn:
                conn.close()

        results.append(brand_result)

    # Train each shared cohort once, after all connected brands have synced, so
    # model input never depends on connection ordering.
    pending_niches = {
        result.get("niche")
        for result in results
        if result.get("train", {}).get("status") == "pending" and result.get("niche")
    }
    for pending_niche in pending_niches:
        try:
            train_result = ModelTrainer.run_training(niche=pending_niche)
            cohort_train = {
                "status": "success",
                "scope": "cohort",
                "accuracy": train_result["metrics"]["accuracy"],
                "f1_score": train_result["metrics"]["f1_score"],
                "model_filename": train_result["model_filename"],
            }
        except Exception:
            logger.exception("Cohort model training failed for niche %s", pending_niche)
            cohort_train = {
                "status": "failed",
                "scope": "cohort",
                "error": "Cohort model training failed. Inspect the ML service logs for the cause.",
            }
        for result in results:
            if (
                result.get("niche") == pending_niche
                and result.get("train", {}).get("status") == "pending"
            ):
                result["train"] = dict(cohort_train)

    # A connected brand without a cohort cannot be trained and must not leave
    # a misleading pending status in an otherwise completed run.
    for result in results:
        if result.get("train", {}).get("status") == "pending":
            result["train"] = {
                "status": "failed",
                "scope": "cohort",
                "error": "The brand has no supported industry cohort.",
            }

    fully_successful = all(
        result.get("sync", {}).get("status") == "success"
        and result.get("train", {}).get("status") == "success"
        for result in results
    )
    return {
        "status": "success" if fully_successful else "partial",
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "results": results,
    }


@app.post("/sync/now", dependencies=[Depends(verify_internal_token)])
def sync_instagram_data_now():
    """
    n8n Orchestration Endpoint (Synchronous).
    Blocks until full sync + retrain pipeline completes. Used by n8n for chaining nodes.
    """
    return _sync_and_retrain_pipeline()
