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

from app.preprocessing import DataPreprocessor, HASHTAG_PATTERN, CTA_PATTERN
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

class TrainRequest(BaseModel):
    brand_id: Optional[str] = None
    niche: Optional[str] = None

class SuggestRequest(BaseModel):
    caption: str
    format: str
    post_hour: int
    brand_id: Optional[str] = None
    niche: Optional[str] = None

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


@app.post("/predict", dependencies=[Depends(verify_internal_token)])
def predict(req: PredictionRequest):
    """
    Extracts features, loads the appropriate Random Forest model (personal or niche),
    classifies the performance tier, and returns the confidence & class probabilities.
    Logs the prediction metadata to the Supabase database.
    """
    try:
        # 1. Load model and bounds bundle (real trained model only)
        try:
            bundle, metadata = ModelLoader.load_model(brand_id=req.brand_id, niche=req.niche)
        except ModelUnavailableError as mue:
            # Honest "no trained model yet" signal instead of a fabricated result
            raise HTTPException(status_code=503, detail=str(mue))

        # 2. Extract features using preprocessor
        features = DataPreprocessor.extract_features(
            caption=req.caption, 
            format_type=req.format, 
            post_hour=req.post_hour
        )
        
        feature_vector = [DataPreprocessor.features_to_list(features)]
        
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
        
        # 4. Log Prediction to Database (Optional & Safe)
        prediction_id = None
        db_url = os.getenv("DATABASE_URL")
        if db_url and req.brand_id:
            try:
                scheduled_date = datetime.date.today()
                if req.scheduled_date:
                    try:
                        scheduled_date = datetime.date.fromisoformat(req.scheduled_date)
                    except ValueError:
                        logger.warning(f"Invalid scheduled_date '{req.scheduled_date}', using today.")
                conn = psycopg2.connect(db_url)
                with conn.cursor() as cur:
                    # Clean features for JSON storage — include confidence so history can display it
                    json_features = {k: float(v) for k, v in features.items()}
                    json_features["confidence"] = confidence
                    cur.execute(
                        """
                        INSERT INTO predictions (brand_id, title, caption, features, pred_class, created_at, scheduled_date, model_version)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                        RETURNING id
                        """,
                        (
                            req.brand_id,
                            f"{req.format} prediction - {datetime.date.today().strftime('%d/%m/%y')}",
                            req.caption,
                            psycopg2.extras.Json(json_features),
                            predicted_class.upper(),
                            datetime.datetime.utcnow(),
                            scheduled_date,
                            metadata.get("version")
                        )
                    )
                    prediction_id = str(cur.fetchone()[0])
                    conn.commit()
                conn.close()
            except Exception as log_err:
                logger.warning(f"Logging prediction to database failed: {log_err}")

        # Determine if personal model or shared niche was active
        is_personal_model_active = metadata.get("model_type") == "account"

        # 5. Extract real MDI (Mean Decrease in Impurity) feature importances from RF model
        feature_names = bundle.get("features", [
            "is_single_image", "is_carousel", "is_reels",
            "post_hour", "caption_length", "hashtag_count", "has_cta"
        ])
        feature_importances = {}
        if hasattr(model, "feature_importances_"):
            mdi_raw = model.feature_importances_
            for i, name in enumerate(feature_names):
                if i < len(mdi_raw):
                    feature_importances[name] = round(float(mdi_raw[i]), 4)

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
                "is_personal_model_active": is_personal_model_active
            },
            "feature_importances": feature_importances
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
    job_id = str(uuid.uuid4())
    
    # Register job in DB
    if db_url:
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
            conn.close()
        except Exception as e:
            logger.warning(f"Failed to record retrain job in database: {e}")
    
    # Run in background
    background_tasks.add_task(run_training_job_async, job_id, req.brand_id, req.niche)
    
    return {
        "status": "pending",
        "job_id": job_id,
        "message": "Retraining job queued successfully in background."
    }


@app.post("/suggest", dependencies=[Depends(verify_internal_token)])
def suggest(req: SuggestRequest):
    """
    Template Recommendation Engine (TRE). Evaluates post attributes against niche averages,
    generating direct parameters adjustments instructions.
    """
    features = DataPreprocessor.extract_features(req.caption, req.format, req.post_hour)
    
    suggestions = []
    
    # 1. Post hour evaluation
    if not (17 <= req.post_hour <= 21):
        suggestions.append({
            "parameter": "post_hour",
            "current": req.post_hour,
            "recommendation": "Move the posting time into the 17:00-21:00 evening window, when audience activity in this niche peaks.",
            "impact": "High"
        })

    # 2. Caption length evaluation
    cap_len = len(req.caption)
    if cap_len < 180:
        suggestions.append({
            "parameter": "caption_length",
            "current": cap_len,
            "recommendation": "Extend the caption to at least 180 characters to build a stronger narrative.",
            "impact": "Medium"
        })
    elif cap_len > 320:
        suggestions.append({
            "parameter": "caption_length",
            "current": cap_len,
            "recommendation": "Shorten the caption below 320 characters so the call-to-action stays above the fold.",
            "impact": "Medium"
        })

    # 3. Hashtag evaluation
    hashtag_count = features["hashtag_count"]
    if hashtag_count < 3:
        suggestions.append({
            "parameter": "hashtag_count",
            "current": hashtag_count,
            "recommendation": "Add industry-specific hashtags until you have 3-8 to improve discoverability.",
            "impact": "High"
        })
    elif hashtag_count > 8:
        suggestions.append({
            "parameter": "hashtag_count",
            "current": hashtag_count,
            "recommendation": "Reduce hashtags to at most 8 so the post does not read as spam.",
            "impact": "Low"
        })

    # 4. CTA evaluation
    if features["has_cta"] == 0.0:
        suggestions.append({
            "parameter": "has_cta",
            "current": "None",
            "recommendation": "Add an explicit call-to-action such as 'Order now' or 'Click the link in bio'.",
            "impact": "High"
        })

    return {
        "status": "success",
        "features_analyzed": features,
        "recommendations": suggestions
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

def _fetch_ig_posts(ig_id: str, token: str, limit: int = 150) -> list:
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

def _get_brands_config() -> list:
    """
    Instagram-connected brands, configured via environment variables.

    Preferred: IG_BRANDS_JSON — a JSON array of objects with keys
    "name", "niche", "instagram_id", "access_token" — so onboarding a new
    brand is a config change, not a code change. The legacy per-brand
    BISON_*/LASENCE_* variables remain supported as a fallback.
    """
    raw = os.getenv("IG_BRANDS_JSON")
    if raw:
        try:
            entries = json.loads(raw)
            return [
                (e["name"], e["niche"], e["instagram_id"], e["access_token"])
                for e in entries
            ]
        except (ValueError, KeyError, TypeError) as e:
            logger.error(f"IG_BRANDS_JSON is malformed ({e}); falling back to legacy variables.")

    config = []
    bison_token = os.getenv("BISON_PAGE_ACCESS_TOKEN")
    bison_ig = os.getenv("BISON_INSTAGRAM_ID")
    if bison_token and bison_ig:
        config.append(("Bison Gym", "Fitness", bison_ig, bison_token))

    lasence_token = os.getenv("LASENCE_PAGE_ACCESS_TOKEN")
    lasence_ig = os.getenv("LASENCE_INSTAGRAM_ID")
    if lasence_token and lasence_ig:
        config.append(("Lasence Bakeshop", "Bakery", lasence_ig, lasence_token))
    return config


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
                    """SELECT b.name, MAX(p.created_at) FROM brands b
                       LEFT JOIN posts p ON p.brand_id = b.id AND p.is_synced
                       GROUP BY b.name"""
                )
                for name, ts in cur.fetchall():
                    last_synced[name] = ts.isoformat() if ts else None
            conn.close()
        except Exception as e:
            logger.warning(f"Instagram health: last-sync lookup failed: {e}")

    for name, niche, ig_id, token in _get_brands_config():
        entry: Dict[str, Any] = {
            "brand": name,
            "niche": niche,
            "last_synced": last_synced.get(name),
        }
        try:
            with httpx.Client(timeout=10.0) as client:
                r = client.get(
                    f"https://graph.facebook.com/v25.0/{ig_id}",
                    params={"fields": "username,followers_count", "access_token": token},
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
def instagram_posts(brand: str, limit: int = 24):
    """
    Live post insights for a linked brand: media previews, engagement
    metrics, and an ER tier graded against the brand's own synced history
    (same percentile method as training labels). Media URLs are fetched
    fresh on every call because Instagram CDN URLs expire.
    """
    config = {name: (niche, ig_id, token) for name, niche, ig_id, token in _get_brands_config()}
    if brand not in config:
        raise HTTPException(status_code=404, detail=f"No Instagram connection configured for '{brand}'.")
    _, ig_id, token = config[brand]
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
                       FROM posts p JOIN brands b ON p.brand_id = b.id
                       WHERE b.name = %s""",
                    (brand,),
                )
                row = cur.fetchone()
                if row and row[0] is not None:
                    p33, p67 = float(row[0]), float(row[1])
            conn.close()
        except Exception as e:
            logger.warning(f"Post insights: percentile lookup failed: {e}")

    posts = []
    for m in media:
        likes = m.get("like_count", 0)
        comments = m.get("comments_count", 0)
        er = round(((likes + comments) / followers) * 100, 4) if followers else 0.0
        tier = None
        if p33 is not None:
            tier = "Low" if er < p33 else ("Average" if er <= p67 else "High")
        posts.append({
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
    return {"status": "success", "brand": brand, "followers": followers, "posts": posts}


def _sync_and_retrain_pipeline():
    """Full pipeline: sync Instagram data then retrain models for each brand."""
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        return {"status": "error", "message": "DATABASE_URL not configured"}

    brands_config = _get_brands_config()
    results = []

    for name, niche, ig_id, token in brands_config:
        brand_result = {"brand": name, "niche": niche, "sync": {}, "train": {}}
        try:
            followers = _fetch_ig_profile(ig_id, token)
            brand_result["sync"]["followers"] = followers

            conn = psycopg2.connect(db_url)
            brand_id = None
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM brands WHERE name = %s", (name,))
                row = cur.fetchone()
                if row:
                    brand_id = str(row[0])
                    cur.execute("UPDATE brands SET followers = %s, niche = %s WHERE id = %s", (followers, niche, brand_id))
                else:
                    cur.execute(
                        "INSERT INTO brands (name, niche, followers, model_type) VALUES (%s, %s, %s, 'personal') RETURNING id",
                        (name, niche, followers)
                    )
                    brand_id = str(cur.fetchone()[0])
            conn.commit()

            posts = _fetch_ig_posts(ig_id, token)
            with conn.cursor() as cur:
                cur.execute("DELETE FROM posts WHERE brand_id = %s", (brand_id,))
                for post in posts:
                    caption = post.get("caption", "")
                    likes = post.get("like_count", 0)
                    comments = post.get("comments_count", 0)
                    media_type = post.get("media_type", "IMAGE")
                    timestamp = post.get("timestamp")
                    er = round(((likes + comments) / followers) * 100, 4) if followers > 0 else 0.0
                    is_single = media_type == "IMAGE"
                    is_carousel = media_type == "CAROUSEL_ALBUM"
                    is_reels = media_type == "VIDEO"
                    ts_clean = timestamp.replace("Z", "+00:00").replace("+0000", "+00:00")
                    dt_utc = datetime.datetime.fromisoformat(ts_clean)
                    post_hour = (dt_utc + datetime.timedelta(hours=7)).hour
                    cur.execute(
                        """INSERT INTO posts (brand_id, caption, er, is_synced, follower_count_at_post,
                            is_single_image, is_carousel, is_reels, post_hour,
                            caption_length, hashtag_count, has_cta, created_at)
                        VALUES (%s,%s,%s,true,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                        (brand_id, caption, er, followers, is_single, is_carousel, is_reels,
                         post_hour, len(caption), len(HASHTAG_PATTERN.findall(caption)),
                         bool(CTA_PATTERN.search(caption)), timestamp)
                    )
            conn.commit()

            # Outcome tracking: link past predictions to the real posts they
            # became (normalized exact-caption match within the brand) and
            # grade the realized tier with the same percentile method used for
            # training labels. Drafts edited before publishing stay unmatched
            # rather than guessed.
            with conn.cursor() as cur:
                cur.execute(
                    """UPDATE predictions pr
                       SET actual_er = p.er
                       FROM posts p
                       WHERE pr.brand_id = %s AND p.brand_id = pr.brand_id
                         AND pr.actual_er IS NULL
                         AND lower(regexp_replace(pr.caption, '\\s+', ' ', 'g')) =
                             lower(regexp_replace(p.caption, '\\s+', ' ', 'g'))""",
                    (brand_id,)
                )
                outcomes = cur.rowcount
                cur.execute(
                    """WITH bounds AS (
                           SELECT percentile_cont(0.33) WITHIN GROUP (ORDER BY er) AS p33,
                                  percentile_cont(0.67) WITHIN GROUP (ORDER BY er) AS p67
                           FROM posts WHERE brand_id = %s
                       )
                       UPDATE predictions SET actual_class =
                           CASE WHEN actual_er < (SELECT p33 FROM bounds) THEN 'LOW'
                                WHEN actual_er <= (SELECT p67 FROM bounds) THEN 'AVERAGE'
                                ELSE 'HIGH' END
                       WHERE brand_id = %s AND actual_er IS NOT NULL""",
                    (brand_id, brand_id)
                )
            conn.commit()
            conn.close()
            brand_result["sync"]["posts_synced"] = len(posts)
            brand_result["sync"]["outcomes_recorded"] = outcomes
            brand_result["sync"]["status"] = "success"
            logger.info(f"[n8n Sync] {name}: {len(posts)} posts synced, {outcomes} prediction outcomes recorded.")

            try:
                train_result = ModelTrainer.run_training(brand_id=brand_id)
                brand_result["train"] = {
                    "status": "success",
                    "accuracy": train_result["metrics"]["accuracy"],
                    "f1_score": train_result["metrics"]["f1_score"],
                    "model_filename": train_result["model_filename"]
                }
                logger.info(f"[n8n Train] {name}: accuracy={train_result['metrics']['accuracy']:.2%}")
            except Exception as te:
                brand_result["train"] = {"status": "failed", "error": str(te)}

        except Exception as e:
            brand_result["sync"]["status"] = "failed"
            brand_result["sync"]["error"] = str(e)

        results.append(brand_result)

    return {"status": "success", "timestamp": datetime.datetime.utcnow().isoformat(), "results": results}


@app.post("/sync/now", dependencies=[Depends(verify_internal_token)])
def sync_instagram_data_now():
    """
    n8n Orchestration Endpoint (Synchronous).
    Blocks until full sync + retrain pipeline completes. Used by n8n for chaining nodes.
    """
    return _sync_and_retrain_pipeline()
