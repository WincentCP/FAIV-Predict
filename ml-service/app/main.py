import os
import re
import json
import uuid
import datetime
import logging
from typing import Optional, Dict, Any
from fastapi import FastAPI, HTTPException, BackgroundTasks, Depends, Header
from dotenv import load_dotenv

# Load environment variables from .env relative to this file
env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
load_dotenv(env_path)
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import numpy as np
import psycopg2
import psycopg2.extras

from app.preprocessing import DataPreprocessor, HASHTAG_PATTERN, CTA_PATTERN, FEATURE_ORDER_V1
from app.model_loader import ModelLoader, ModelUnavailableError
from app.train_pipeline import ModelTrainer

# Configure Logging
logger = logging.getLogger("main")
logging.basicConfig(level=logging.INFO)

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
# Requests to this service must carry a shared secret. When INTERNAL_API_TOKEN
# is unset we log a loud warning and allow the request (local dev only);
# production deployments MUST set INTERNAL_API_TOKEN.
INTERNAL_API_TOKEN = os.getenv("INTERNAL_API_TOKEN")
if not INTERNAL_API_TOKEN:
    logger.warning(
        "INTERNAL_API_TOKEN is not set. The ML service is UNAUTHENTICATED. "
        "Set INTERNAL_API_TOKEN in production."
    )


def verify_internal_token(x_internal_token: Optional[str] = Header(default=None)):
    """Rejects requests that do not present the shared internal token."""
    if not INTERNAL_API_TOKEN:
        return
    if x_internal_token != INTERNAL_API_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized: invalid internal token")

# Pydantic Schemas for Requests
class PredictionRequest(BaseModel):
    caption: str
    format: str
    post_hour: int
    brand_id: Optional[str] = None
    niche: Optional[str] = None
    scheduled_date: Optional[str] = None  # ISO date (YYYY-MM-DD)
    created_by: Optional[str] = None

class TrainRequest(BaseModel):
    brand_id: Optional[str] = None
    niche: Optional[str] = None

class InstagramPostInsightsRequest(BaseModel):
    brand_id: str
    media_id: str
    caption: Optional[str] = None
    created_by: Optional[str] = None

# DB connection helper
def get_db_connection():
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise HTTPException(status_code=500, detail="Database URL not configured")
    return psycopg2.connect(db_url)


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
        result = ModelTrainer.run_training(brand_id, niche)

        if db_url and conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE model_retrain_jobs 
                    SET status = 'success', completed_at = %s, finished_at = %s 
                    WHERE id = %s
                    """,
                    (datetime.datetime.utcnow(), datetime.datetime.utcnow(), job_id)
                )
                conn.commit()
            logger.info(f"Background training job {job_id} succeeded.")
    except Exception as e:
        logger.error(f"Background training job {job_id} failed: {e}")
        if db_url and conn:
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE model_retrain_jobs SET status = 'failed', error_message = %s WHERE id = %s",
                        (str(e), job_id)
                    )
                    conn.commit()
            except Exception as inner_e:
                logger.error(f"Failed to record failure in DB for job {job_id}: {inner_e}")
    finally:
        if conn:
            conn.close()


def build_counterfactuals(model, base_features, feature_order, classes, base_probs):
    """
    What-if analysis: re-scores single-feature variants of the SAME draft with
    the SAME model and reports the measured change in P(High). This is
    evidence, not heuristics — probes that show no gain are reported honestly.
    Probes only touch features the loaded model was actually trained on.
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
    hour = int(base_features.get("post_hour", 0))
    for h in (9, 12, 17, 19, 21):
        if h != hour:
            probes.append(("post_hour", f"Move posting time to {h}:00", hour, h, {"post_hour": float(h)}))
    if base_features.get("has_cta", 0.0) == 0.0:
        probes.append(("has_cta", "Add a call-to-action", "No", "Yes", {"has_cta": 1.0}))
    tags = base_features.get("hashtag_count", 0.0)
    if tags < 3 or tags > 8:
        probes.append(("hashtag_count", "Use 5 hashtags", int(tags), 5, {"hashtag_count": 5.0}))
    length = base_features.get("caption_length", 0.0)
    if length < 180 or length > 320:
        probes.append(("caption_length", "Bring the caption to ~250 characters", int(length), 250, {"caption_length": 250.0}))
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

    # Keep only the single best posting-hour probe — four near-identical hour
    # rows would drown the rest of the list.
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
    classifies the performance tier, and returns the confidence & class probabilities.
    Persists brand-scoped predictions with authenticated-user provenance.
    """
    try:
        if req.brand_id:
            try:
                uuid.UUID(req.brand_id)
                uuid.UUID(str(req.created_by or ""))
            except ValueError:
                raise HTTPException(
                    status_code=400,
                    detail="brand_id and created_by must be valid UUIDs for a persisted prediction.",
                )

        sched_date = datetime.date.today()
        if req.scheduled_date:
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

        # 2. Extract features using preprocessor. The weekend flag comes from
        # the validated scheduled date (or today when no date was supplied),
        # matching training-side semantics.
        features = DataPreprocessor.extract_features(
            caption=req.caption,
            format_type=req.format,
            post_hour=req.post_hour,
            is_weekend=sched_date.weekday() >= 5,
        )

        # The bundle's own stored feature list drives vector order so old
        # 7-feature artifacts keep working after the feature set grew.
        feature_order = bundle.get("features") or FEATURE_ORDER_V1
        out_of_range = DataPreprocessor.out_of_range_features(
            features, bundle.get("feature_ranges")
        )
        feature_vector = [DataPreprocessor.features_to_list(features, feature_order)]
        
        # Extract components from bundle
        model = bundle["model"]
        classes = model.classes_
        
        # 3. Model Inference
        pred_raw = model.predict(feature_vector)[0]
        probs_raw = model.predict_proba(feature_vector)[0]
        
        # Map class and probabilities to Title Case for Frontend consistency ("High", "Average", "Low")
        predicted_class = pred_raw.title()
        probabilities = {classes[i].title(): round(float(probs_raw[i]) * 100, 2) for i in range(len(classes))}
        confidence = round(float(np.max(probs_raw)) * 100, 2)
        
        # 4. Persist the prediction. Brand-scoped requests are only successful
        # when their creator provenance is durably recorded.
        prediction_id = None
        db_url = os.getenv("DATABASE_URL")
        if db_url and req.brand_id:
            conn = None
            try:
                conn = psycopg2.connect(db_url)
                with conn.cursor() as cur:
                    # Clean features for JSON storage — include confidence so history can display it
                    json_features = {k: float(v) for k, v in features.items()}
                    json_features["confidence"] = confidence
                    cur.execute(
                        """
                        INSERT INTO predictions (brand_id, created_by, title, caption, features, pred_class, created_at, scheduled_date, model_version)
                        SELECT %s, %s, %s, %s, %s, %s, %s, %s, %s
                        WHERE EXISTS (
                            SELECT 1 FROM brands WHERE id = %s AND owner_id = %s
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
                            datetime.datetime.utcnow(),
                            sched_date,
                            metadata.get("version"),
                            req.brand_id,
                            req.created_by,
                        )
                    )
                    inserted = cur.fetchone()
                    if not inserted:
                        raise ValueError("Prediction brand is not owned by created_by")
                    prediction_id = str(inserted[0])
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

        # Determine if personal model or shared niche was active
        is_personal_model_active = metadata.get("model_type") == "account"

        # 5. Extract real MDI (Mean Decrease in Impurity) feature importances from RF model
        feature_names = feature_order
        feature_importances = {}
        if hasattr(model, "feature_importances_"):
            mdi_raw = model.feature_importances_
            for i, name in enumerate(feature_names):
                if i < len(mdi_raw):
                    feature_importances[name] = round(float(mdi_raw[i]), 4)

        # 6. Counterfactual what-if analysis: measured P(High) deltas for
        # single-feature changes to this exact draft.
        counterfactuals, cf_note = build_counterfactuals(
            model, features, feature_order, classes, probs_raw
        )

        # Training-set size for the trust display (metrics may be a JSON string
        # depending on the driver).
        trained_samples = None
        metrics_blob = metadata.get("metrics")
        if isinstance(metrics_blob, str):
            try:
                metrics_blob = json.loads(metrics_blob)
            except ValueError:
                metrics_blob = None
        if isinstance(metrics_blob, dict):
            trained_samples = metrics_blob.get("train_samples")

        return {
            "status": "success",
            "predicted_class": predicted_class,
            "confidence": confidence,
            "probabilities": probabilities,
            "prediction_id": prediction_id,
            "model_metadata": {
                "model_id": metadata.get("id"),
                "model_type": metadata.get("model_type"),
                "version": metadata.get("version"),
                # Validated accuracy from training (newest 20% of posts) so the
                # UI can show how trustworthy this model has proven to be.
                "accuracy": float(metadata["accuracy"]) if metadata.get("accuracy") is not None else None,
                "is_personal_model_active": is_personal_model_active,
                "feature_names": feature_order,
                "trained_samples": trained_samples
            },
            "feature_importances": feature_importances,
            "out_of_range": out_of_range,
            "counterfactuals": counterfactuals,
            "counterfactuals_note": cf_note
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Prediction failed: {e}")
        raise HTTPException(status_code=500, detail=f"Prediction error: {str(e)}")


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
    
    # Register job in DB
    conn = None
    try:
        conn = psycopg2.connect(db_url)
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO model_retrain_jobs (id, brand_id, status, created_at)
                VALUES (%s, %s, 'pending', %s)
                """,
                (job_id, req.brand_id, datetime.datetime.utcnow())
            )
            conn.commit()
    except Exception as e:
        logger.error(f"Failed to record retrain job in database: {e}")
        raise HTTPException(status_code=503, detail="Cannot queue retraining: job store is unavailable.")
    finally:
        if conn:
            conn.close()
    
    # Run in background
    background_tasks.add_task(run_training_job_async, job_id, req.brand_id, req.niche)
    
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
    except Exception as e:
        logger.error(f"Failed to query train status: {e}")
        raise HTTPException(status_code=503, detail=f"Job status query failed: {e}")
    finally:
        if conn:
            conn.close()


# ──────────────────────────────────────────────────────────────────
# n8n Orchestration Endpoint: Sync Instagram Data + Auto-Retrain
# ──────────────────────────────────────────────────────────────────
import httpx

def _fetch_ig_profile(ig_id: str, token: str) -> int:
    url = f"https://graph.facebook.com/v25.0/{ig_id}"
    params = {"fields": "followers_count", "access_token": token}
    with httpx.Client(timeout=15.0) as client:
        r = client.get(url, params=params)
        r.raise_for_status()
        return r.json().get("followers_count", 0)

def _fetch_ig_posts(ig_id: str, token: str, limit: int = 250) -> list:
    url = f"https://graph.facebook.com/v25.0/{ig_id}/media"
    params = {"fields": "caption,like_count,comments_count,media_type,timestamp", "limit": limit, "access_token": token}
    posts = []
    with httpx.Client(timeout=30.0) as client:
        while url and len(posts) < limit:
            r = client.get(url, params=params)
            r.raise_for_status()
            res = r.json()
            posts.extend(res.get("data", []))
            url = res.get("paging", {}).get("next")
            params = {}
            if not res.get("data") or not url:
                break
    return posts[:limit]

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
        for entry in entries:
            brand_id = str(entry["brand_id"])
            uuid.UUID(brand_id)
            instagram_id = str(entry["instagram_id"]).strip()
            access_token = str(entry["access_token"]).strip()
            if not instagram_id or not access_token:
                raise ValueError("instagram_id and access_token must be non-empty")
            if brand_id in seen_brand_ids:
                raise ValueError(f"duplicate brand_id: {brand_id}")
            seen_brand_ids.add(brand_id)
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
            cur.execute("SELECT id, name, niche FROM brands WHERE owner_id IS NOT NULL")
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

        if brand:
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


@app.get("/instagram/health", dependencies=[Depends(verify_internal_token)])
def instagram_health():
    """
    Connection health for every Instagram-linked brand: verifies each access
    token against the Graph API live and reports when data was last synced.
    Surfaces token expiry BEFORE the weekly pipeline silently starts failing.
    """
    connections = []
    last_synced: Dict[str, Optional[str]] = {}
    db_url = os.getenv("DATABASE_URL")
    if db_url:
        try:
            conn = psycopg2.connect(db_url)
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT b.id, MAX(p.created_at) FROM brands b
                       LEFT JOIN posts p ON p.brand_id = b.id AND p.is_synced
                       GROUP BY b.id"""
                )
                for brand_id, ts in cur.fetchall():
                    last_synced[str(brand_id)] = ts.isoformat() if ts else None
            conn.close()
        except Exception as e:
            logger.warning(f"Instagram health: last-sync lookup failed: {e}")

    for config in _bound_instagram_configs():
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
        except Exception as e:
            entry.update({"status": "unreachable", "error": str(e)})
        connections.append(entry)

    return {"status": "success", "connections": connections}


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
    try:
        followers = _fetch_ig_profile(ig_id, token)
        params = {
            "fields": "caption,like_count,comments_count,media_type,media_url,thumbnail_url,permalink,timestamp",
            "limit": min(max(limit, 1), 50),
            "access_token": token,
        }
        with httpx.Client(timeout=30.0) as client:
            r = client.get(f"https://graph.facebook.com/v25.0/{ig_id}/media", params=params)
            r.raise_for_status()
            media = r.json().get("data", [])
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"Instagram API error: HTTP {e.response.status_code}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Instagram API unreachable: {e}")

    p33 = p67 = None
    db_url = os.getenv("DATABASE_URL")
    if db_url:
        try:
            conn = psycopg2.connect(db_url)
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT percentile_cont(0.33) WITHIN GROUP (ORDER BY p.er),
                              percentile_cont(0.67) WITHIN GROUP (ORDER BY p.er)
                       FROM posts p
                       WHERE p.brand_id = %s
                         AND p.source = 'instagram_graph'
                         AND p.instagram_media_id IS NOT NULL""",
                    (brand_id,),
                )
                row = cur.fetchone()
                if row and row[0] is not None:
                    p33, p67 = float(row[0]), float(row[1])
            conn.close()
        except Exception as e:
            logger.warning(f"Post insights: percentile lookup failed: {e}")

    posts = []
    for m in media:
        likes = m.get("like_count") if isinstance(m.get("like_count"), (int, float)) else None
        comments = m.get("comments_count") if isinstance(m.get("comments_count"), (int, float)) else None
        er = (
            round(((likes + comments) / followers) * 100, 4)
            if followers > 0 and likes is not None and comments is not None
            else None
        )
        tier = None
        if p33 is not None and er is not None:
            tier = "Low" if er < p33 else ("Average" if er <= p67 else "High")
        posts.append({
            "id": m.get("id"),
            "caption": m.get("caption", ""),
            "media_type": m.get("media_type"),
            "media_url": m.get("media_url"),
            "thumbnail_url": m.get("thumbnail_url"),
            "permalink": m.get("permalink"),
            "timestamp": m.get("timestamp"),
            "likes": likes,
            "comments": comments,
            "er": er,
            "tier": tier,
        })
    return {"status": "success", "brand_id": brand_id, "brand": brand, "followers": followers, "posts": posts}


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
            params={"fields": "id,owner", "access_token": token},
        )
        if ownership.status_code != 200:
            raise HTTPException(status_code=404, detail="Instagram media was not found for this connection.")
        owner_id = str((ownership.json().get("owner") or {}).get("id") or "")
        if owner_id != str(config["instagram_id"]):
            raise HTTPException(status_code=404, detail="Instagram media does not belong to this brand.")

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

    historical: Dict[str, Optional[float]] = {
        "brand_median_er": None,
        "recent_median_er": None,
    }
    prediction = None
    db_url = os.getenv("DATABASE_URL")
    if db_url:
        conn = None
        try:
            conn = psycopg2.connect(db_url)
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY p.er) AS brand_median_er
                       FROM posts p
                       WHERE p.brand_id = %s
                         AND p.source = 'instagram_graph'
                         AND p.instagram_media_id IS NOT NULL""",
                    (req.brand_id,),
                )
                row = cur.fetchone()
                if row and row.get("brand_median_er") is not None:
                    historical["brand_median_er"] = float(row["brand_median_er"])
                cur.execute(
                    """SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY recent.er) AS recent_median_er
                       FROM (
                         SELECT p.er FROM posts p
                         WHERE p.brand_id = %s
                           AND p.source = 'instagram_graph'
                           AND p.instagram_media_id IS NOT NULL
                         ORDER BY p.created_at DESC LIMIT 10
                       ) recent""",
                    (req.brand_id,),
                )
                row = cur.fetchone()
                if row and row.get("recent_median_er") is not None:
                    historical["recent_median_er"] = float(row["recent_median_er"])

                if req.caption:
                    normalized = re.sub(r"\s+", " ", req.caption.strip().lower())
                    cur.execute(
                        """SELECT p.pred_class, p.actual_class, p.actual_source, p.model_version,
                                  p.features->>'confidence' AS confidence
                           FROM predictions p
                           WHERE p.brand_id = %s AND p.created_by = %s
                             AND regexp_replace(lower(trim(coalesce(p.caption, ''))), '\\s+', ' ', 'g') = %s
                           ORDER BY p.created_at DESC LIMIT 1""",
                        (req.brand_id, req.created_by, normalized),
                    )
                    match = cur.fetchone()
                    if match:
                        prediction = {
                            "tier": str(match["pred_class"]).title(),
                            "actual_tier": (
                                str(match["actual_class"]).title()
                                if match.get("actual_source") == "instagram_media_id" and match.get("actual_class")
                                else None
                            ),
                            "confidence": float(match["confidence"]) if match.get("confidence") else None,
                            "model_version": match.get("model_version"),
                            "match_method": "exact_caption",
                        }
        except Exception as exc:
            logger.warning(f"Post detail comparison lookup failed: {exc}")
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
    }


def _upsert_instagram_media(cur, brand_id: str, post: Dict[str, Any], current_followers: int) -> str:
    """Insert or refresh one Graph API media row without deleting history.

    The immutable Instagram media ID is the identity key. On the first run
    after migration, one legacy row may be claimed only when both timestamp
    and caption match exactly. Its original follower denominator is preserved.
    """
    media_id = str(post["id"])
    caption = post.get("caption") or ""
    timestamp = str(post["timestamp"])
    likes = float(post["like_count"])
    comments = float(post["comments_count"])
    media_type = post.get("media_type", "IMAGE")
    ts_clean = timestamp.replace("Z", "+00:00").replace("+0000", "+00:00")
    dt_utc = datetime.datetime.fromisoformat(ts_clean)
    post_hour = (dt_utc + datetime.timedelta(hours=7)).hour

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
        media_id, caption, er, denominator,
        media_type == "IMAGE", media_type == "CAROUSEL_ALBUM", media_type == "VIDEO",
        post_hour, len(caption), len(HASHTAG_PATTERN.findall(caption)),
        bool(CTA_PATTERN.search(caption)), timestamp,
    )

    if existing:
        cur.execute(
            """UPDATE posts SET
                 instagram_media_id = %s, source = 'instagram_graph',
                 caption = %s, er = %s, is_synced = true,
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
                 brand_id, instagram_media_id, source, caption, er, is_synced,
                 follower_count_at_post, is_single_image, is_carousel, is_reels,
                 post_hour, caption_length, hashtag_count, has_cta, created_at, synced_at
               ) VALUES (
                 %s, %s, 'instagram_graph', %s, %s, true,
                 %s, %s, %s, %s, %s, %s, %s, %s, %s,
                 timezone('utc'::text, now())
               )""",
            (brand_id, *values),
        )
    return result


def _sync_and_retrain_pipeline():
    """Sync configured Instagram accounts and train the appropriate model.

    Connections must already be bound to an existing brand; sync never creates
    user-facing rows. Accounts with at least 200 posts train a personal model.
    Smaller accounts contribute to one shared cohort model per run.
    """
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        return {"status": "error", "message": "DATABASE_URL not configured"}

    brands_config = _bound_instagram_configs()
    if not brands_config:
        return {
            "status": "error",
            "message": "No Instagram connections are configured.",
            "timestamp": datetime.datetime.utcnow().isoformat(),
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
            if followers <= 0:
                raise ValueError(
                    "Instagram returned no usable follower denominator; refusing to write fabricated 0% engagement rates."
                )

            posts = _fetch_ig_posts(config["instagram_id"], config["access_token"])
            valid_posts = [
                post for post in posts
                if isinstance(post.get("like_count"), (int, float))
                and isinstance(post.get("comments_count"), (int, float))
                and post.get("id")
                and post.get("timestamp")
            ]
            if not valid_posts:
                raise ValueError("Instagram returned no posts with complete engagement and timestamp fields; existing history was preserved.")
            if len(valid_posts) != len(posts):
                logger.warning(f"Skipping {len(posts) - len(valid_posts)} incomplete Instagram media rows for {name}.")
            conn = psycopg2.connect(db_url)
            sync_counts = {"inserted": 0, "updated": 0, "claimed": 0}
            with conn.cursor() as cur:
                # This row lock serializes concurrent syncs for the same brand
                # until the media upserts commit.
                cur.execute("UPDATE brands SET followers = %s WHERE id = %s", (followers, brand_id))
                if cur.rowcount != 1:
                    raise ValueError("Bound brand no longer exists")
                for post in valid_posts:
                    sync_result = _upsert_instagram_media(cur, brand_id, post, followers)
                    sync_counts[sync_result] += 1
                cur.execute(
                    """SELECT COUNT(*) FROM posts
                       WHERE brand_id = %s
                         AND source = 'instagram_graph'
                         AND instagram_media_id IS NOT NULL""",
                    (brand_id,),
                )
                stored_count = int(cur.fetchone()[0])
            conn.commit()
            conn.close()
            conn = None
            brand_result["sync"]["posts_received"] = len(posts)
            brand_result["sync"]["posts_synced"] = len(valid_posts)
            brand_result["sync"]["posts_inserted"] = sync_counts["inserted"]
            brand_result["sync"]["posts_updated"] = sync_counts["updated"]
            brand_result["sync"]["legacy_rows_claimed"] = sync_counts["claimed"]
            brand_result["sync"]["stored_verified_posts"] = stored_count
            brand_result["sync"]["status"] = "success"
            logger.info(
                f"[n8n Sync] {name}: {len(valid_posts)}/{len(posts)} posts synced "
                f"({sync_counts['inserted']} inserted, {sync_counts['updated']} updated, "
                f"{sync_counts['claimed']} legacy rows claimed)."
            )

            try:
                if stored_count >= 200:
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
            except Exception as te:
                brand_result["train"] = {"status": "failed", "error": str(te)}

        except Exception as e:
            brand_result["sync"]["status"] = "failed"
            brand_result["sync"]["error"] = str(e)
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
        except Exception as exc:
            cohort_train = {"status": "failed", "scope": "cohort", "error": str(exc)}
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
        "timestamp": datetime.datetime.utcnow().isoformat(),
        "results": results,
    }


@app.post("/sync/now", dependencies=[Depends(verify_internal_token)])
def sync_instagram_data_now():
    """
    n8n Orchestration Endpoint (Synchronous).
    Blocks until full sync + retrain pipeline completes. Used by n8n for chaining nodes.
    """
    return _sync_and_retrain_pipeline()
