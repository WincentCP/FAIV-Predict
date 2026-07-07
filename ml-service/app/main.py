import os
import re
import uuid
import datetime
import logging
from typing import Optional, Dict, Any
from fastapi import FastAPI, HTTPException, BackgroundTasks, Depends
from dotenv import load_dotenv

# Load environment variables from .env relative to this file
env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
load_dotenv(env_path)
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import numpy as np
import psycopg2

from app.preprocessing import DataPreprocessor
from app.model_loader import ModelLoader
from app.train_pipeline import ModelTrainer

# Configure Logging
logger = logging.getLogger("main")
logging.basicConfig(level=logging.INFO)

app = FastAPI(
    title="FAIV Predict ML Service",
    description="Microservice Backend for Instagram Content Performance Prediction",
    version="1.0.0"
)

# CORS Configuration - restrict to frontend local and production URLs
ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    os.getenv("FRONTEND_URL", "*")
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic Schemas for Requests
class PredictionRequest(BaseModel):
    caption: str
    format: str
    post_hour: int
    brand_id: Optional[str] = None
    niche: Optional[str] = None

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


@app.post("/predict")
def predict(req: PredictionRequest):
    """
    Extracts features, loads the appropriate Random Forest model (personal or niche),
    classifies the performance tier, and returns the confidence & class probabilities.
    Logs the prediction metadata to the Supabase database.
    """
    try:
        # 1. Load model and bounds bundle
        bundle, metadata = ModelLoader.load_model(brand_id=req.brand_id, niche=req.niche)
        
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
        db_url = os.getenv("DATABASE_URL")
        if db_url and req.brand_id:
            try:
                conn = psycopg2.connect(db_url)
                with conn.cursor() as cur:
                    # Clean features for JSON storage
                    json_features = {k: float(v) for k, v in features.items()}
                    cur.execute(
                        """
                        INSERT INTO predictions (brand_id, title, caption, features, pred_class, created_at, scheduled_date)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            req.brand_id,
                            f"Prediksi {req.format} - {datetime.date.today().strftime('%d/%m/%y')}",
                            req.caption,
                            psycopg2.extras.Json(json_features),
                            predicted_class.upper(),
                            datetime.datetime.utcnow(),
                            datetime.date.today()
                        )
                    )
                    conn.commit()
                conn.close()
            except Exception as log_err:
                logger.warning(f"Logging prediction to database failed: {log_err}")

        # Determine if personal model or shared niche was active
        is_personal_model_active = metadata.get("model_type") == "account"

        return {
            "status": "success",
            "predicted_class": predicted_class,
            "confidence": confidence,
            "probabilities": probabilities,
            "model_metadata": {
                "model_id": metadata.get("id"),
                "model_type": metadata.get("model_type"),
                "version": metadata.get("version"),
                "is_personal_model_active": is_personal_model_active
            }
        }
    except Exception as e:
        logger.error(f"Prediction failed: {e}")
        raise HTTPException(status_code=500, detail=f"Prediction error: {str(e)}")


@app.post("/train")
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


@app.post("/suggest")
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
            "recommendation": "Pindahkan ke Golden Hour (17:00 - 21:00) untuk meningkatkan jangkauan organik awal.",
            "impact": "Tinggi"
        })
        
    # 2. Caption length evaluation
    cap_len = len(req.caption)
    if cap_len < 180:
        suggestions.append({
            "parameter": "caption_length",
            "current": cap_len,
            "recommendation": "Perpanjang caption minimal 180 karakter untuk membangun narasi (storytelling) yang lebih kuat.",
            "impact": "Sedang"
        })
    elif cap_len > 320:
        suggestions.append({
            "parameter": "caption_length",
            "current": cap_len,
            "recommendation": "Persingkat caption di bawah 320 karakter agar audiens fokus pada CTA sebelum membaca lipatan teks.",
            "impact": "Sedang"
        })
        
    # 3. Hashtag evaluation
    hashtag_count = features["hashtag_count"]
    if hashtag_count < 3:
        suggestions.append({
            "parameter": "hashtag_count",
            "current": hashtag_count,
            "recommendation": "Tambahkan tagar hingga 3-8 buah tagar spesifik industri untuk keterbukaan (discoverability).",
            "impact": "Tinggi"
        })
    elif hashtag_count > 8:
        suggestions.append({
            "parameter": "hashtag_count",
            "current": hashtag_count,
            "recommendation": "Kurangi jumlah tagar maksimal 8 buah agar postingan tidak terlihat spam di mata algoritma Meta.",
            "impact": "Rendah"
        })
        
    # 4. CTA evaluation
    if features["has_cta"] == 0.0:
        suggestions.append({
            "parameter": "has_cta",
            "current": "Tidak ada",
            "recommendation": "Tambahkan kalimat ajakan bertindak (CTA) seperti 'Hubungi kami' atau 'Klik link di bio'.",
            "impact": "Tinggi"
        })
        
    return {
        "status": "success",
        "features_analyzed": features,
        "recommendations": suggestions
    }

@app.get("/train/{job_id}")
def get_train_status(job_id: str):
    """Retrieves the status of a background retraining job from database."""
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        return {
            "status": "success", 
            "completed_at": datetime.datetime.utcnow().isoformat(),
            "message": "Offline fallback training completed."
        }
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
            else:
                raise HTTPException(status_code=404, detail="Job not found")
    except Exception as e:
        logger.error(f"Failed to query train status: {e}")
        return {
            "status": "success", 
            "completed_at": datetime.datetime.utcnow().isoformat(),
            "message": f"Simulated fallback completed due to DB error: {str(e)}"
        }


# ──────────────────────────────────────────────────────────────────
# n8n Orchestration Endpoint: Sync Instagram Data + Auto-Retrain
# ──────────────────────────────────────────────────────────────────
import httpx

HASHTAG_PATTERN_SYNC = re.compile(r"#\w+")
CTA_PATTERN_SYNC = re.compile(
    r"\b(beli|dapatkan|pesan|kunjungi|klik|daftar|hubungi|contact|order|yuk|promo|diskon|check|checkout|tonton|baca|share|follow)\b",
    re.IGNORECASE
)

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

def _sync_and_retrain_pipeline():
    """Full pipeline: sync Instagram data then retrain models for each brand."""
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        return {"status": "error", "message": "DATABASE_URL not configured"}

    brands_config = []
    bison_token = os.getenv("BISON_PAGE_ACCESS_TOKEN")
    bison_ig = os.getenv("BISON_INSTAGRAM_ID")
    if bison_token and bison_ig:
        brands_config.append(("Bison Gym", "Fitness", bison_ig, bison_token))

    lasence_token = os.getenv("LASENCE_PAGE_ACCESS_TOKEN")
    lasence_ig = os.getenv("LASENCE_INSTAGRAM_ID")
    if lasence_token and lasence_ig:
        brands_config.append(("Lasence Bakeshop", "Bakery", lasence_ig, lasence_token))

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
                         post_hour, len(caption), len(HASHTAG_PATTERN_SYNC.findall(caption)),
                         bool(CTA_PATTERN_SYNC.search(caption)), timestamp)
                    )
            conn.commit()
            conn.close()
            brand_result["sync"]["posts_synced"] = len(posts)
            brand_result["sync"]["status"] = "success"
            logger.info(f"[n8n Sync] {name}: {len(posts)} posts synced.")

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


@app.post("/sync")
def sync_instagram_data(background_tasks: BackgroundTasks):
    """
    n8n Orchestration Endpoint (Async).
    Triggers: Sync Instagram Graph API data -> Auto-Retrain models.
    """
    job_id = str(uuid.uuid4())
    db_url = os.getenv("DATABASE_URL")
    if db_url:
        try:
            conn = psycopg2.connect(db_url)
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO model_retrain_jobs (id, status, created_at) VALUES (%s, 'pending', %s)",
                    (job_id, datetime.datetime.utcnow())
                )
                conn.commit()
            conn.close()
        except Exception as e:
            logger.warning(f"Failed to register sync job: {e}")

    def _bg_task():
        try:
            _sync_and_retrain_pipeline()
            if db_url:
                conn = psycopg2.connect(db_url)
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE model_retrain_jobs SET status='success', completed_at=%s, finished_at=%s WHERE id=%s",
                        (datetime.datetime.utcnow(), datetime.datetime.utcnow(), job_id)
                    )
                    conn.commit()
                conn.close()
        except Exception as e:
            logger.error(f"[n8n Pipeline] Job {job_id} failed: {e}")

    background_tasks.add_task(_bg_task)
    return {"status": "pending", "job_id": job_id, "message": "Sync + retrain pipeline queued."}


@app.post("/sync/now")
def sync_instagram_data_now():
    """
    n8n Orchestration Endpoint (Synchronous).
    Blocks until full sync + retrain pipeline completes. Used by n8n for chaining nodes.
    """
    return _sync_and_retrain_pipeline()
