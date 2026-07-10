import os
import re
import datetime
import logging
import json
import joblib
import httpx
import numpy as np
import pandas as pd
import psycopg2
from psycopg2.extras import RealDictCursor
from typing import Optional, Tuple, Dict, Any
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, precision_recall_fscore_support

from app.preprocessing import DataPreprocessor

logger = logging.getLogger("train_pipeline")
logging.basicConfig(level=logging.INFO)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_DIR = os.path.join(BASE_DIR, "models_cache")
os.makedirs(CACHE_DIR, exist_ok=True)

# Minimum number of real historical posts required to train a model.
MIN_TRAINING_SAMPLES = 30


class InsufficientDataError(Exception):
    """Raised when there is not enough real data to train a trustworthy model."""

class ModelTrainer:
    """
    ML Pipeline for training, evaluating, and deploying RandomForest models
    for specific brands or niches.
    """

    @staticmethod
    def _get_db_connection():
        db_url = os.getenv("DATABASE_URL")
        if not db_url:
            raise ValueError("DATABASE_URL environment variable is not set.")
        return psycopg2.connect(db_url)

    @classmethod
    def _cleanup_old_cached_models(cls, model_type: str, identifier: str, keep_limit: int = 2):
        """
        Removes older cached model files of the same type and brand/niche to prevent disk bloat.
        Only keeps the newest `keep_limit` files.
        """
        try:
            files = []
            prefix = f"model_{model_type}_{identifier}_"
            for f in os.listdir(CACHE_DIR):
                if f.startswith(prefix) and f.endswith(".joblib"):
                    full_path = os.path.join(CACHE_DIR, f)
                    files.append((full_path, os.path.getmtime(full_path)))
            
            # Sort files by modification time descending (newest first)
            files.sort(key=lambda x: x[1], reverse=True)
            
            # Remove files beyond the keep_limit
            if len(files) > keep_limit:
                for old_file, _ in files[keep_limit:]:
                    try:
                        os.remove(old_file)
                        logger.info(f"Cleaned up old cached model file: {old_file}")
                    except Exception as fe:
                        logger.warning(f"Could not remove old cached model file {old_file}: {fe}")
        except Exception as e:
            logger.warning(f"Error cleaning up old cached models: {e}")


    @classmethod
    def fetch_historical_data(cls, brand_id: Optional[str] = None, niche: Optional[str] = None) -> pd.DataFrame:
        """
        Fetches real historical posts for training from the database.

        Raises InsufficientDataError if the database is unreachable or there are
        fewer than MIN_TRAINING_SAMPLES real posts. We never fabricate training
        data: a model must be trained on real engagement history to be trustworthy.
        """
        data = []
        conn = None
        try:
            conn = cls._get_db_connection()
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                if brand_id:
                    logger.info(f"Querying historical posts for brand ID: {brand_id}")
                    cur.execute(
                        """
                        SELECT caption, er, is_single_image, is_carousel, is_reels, post_hour,
                               follower_count_at_post, caption_length, hashtag_count, has_cta
                        FROM posts
                        WHERE brand_id = %s
                        ORDER BY created_at ASC
                        """,
                        (brand_id,)
                    )
                    data = [dict(row) for row in cur.fetchall()]
                elif niche:
                    logger.info(f"Querying historical posts for niche: {niche}")
                    cur.execute(
                        """
                        SELECT p.caption, p.er, p.is_single_image, p.is_carousel, p.is_reels, p.post_hour, 
                               p.follower_count_at_post, p.caption_length, p.hashtag_count, p.has_cta 
                        FROM posts p
                        JOIN brands b ON p.brand_id = b.id
                        WHERE b.niche = %s
                        ORDER BY p.created_at ASC
                        """,
                        (niche,)
                    )
                    data = [dict(row) for row in cur.fetchall()]
        except Exception as e:
            logger.error(f"Database query failed or is unconfigured: {e}")
            raise InsufficientDataError(
                "Cannot train: the historical posts database is unreachable. "
                "Configure DATABASE_URL and sync real data first."
            )

        if len(data) < MIN_TRAINING_SAMPLES:
            raise InsufficientDataError(
                f"Cannot train: only {len(data)} real posts found for "
                f"{'brand ' + str(brand_id) if brand_id else 'niche ' + str(niche)}; "
                f"at least {MIN_TRAINING_SAMPLES} are required. Sync more data first."
            )

        return pd.DataFrame(data)

    @classmethod
    def upload_to_supabase_storage(cls, file_path: str, storage_path: str) -> Optional[str]:
        """Uploads file to Supabase Storage models bucket using credentials."""
        supabase_url = os.getenv("SUPABASE_URL")
        supabase_key = os.getenv("SUPABASE_KEY")
        if not supabase_url or not supabase_key:
            logger.warning("Supabase URL or Key not set. Skipping remote storage upload.")
            return None

        bucket_name = "models"
        upload_url = f"{supabase_url.rstrip('/')}/storage/v1/object/{bucket_name}/{storage_path.lstrip('/')}"
        
        # New-format keys (sb_secret_...) are only valid in the apikey header;
        # legacy JWT service keys also work as a Bearer token.
        headers = {
            "apikey": supabase_key,
            "Authorization": f"Bearer {supabase_key}",
            "Content-Type": "application/octet-stream"
        }
        
        try:
            with open(file_path, "rb") as f:
                file_content = f.read()
                
            # Perform PUT or POST request to upload/overwrite
            with httpx.Client(timeout=30.0) as client:
                # Try PUT first to overwrite if exists
                logger.info(f"Uploading model binary to Supabase Storage: {upload_url}")
                response = client.put(upload_url, headers=headers, content=file_content)
                if response.status_code != 200:
                    # Try POST if PUT is not allowed/supported directly without object existence
                    response = client.post(upload_url, headers=headers, content=file_content)
                    
                if response.status_code in [200, 201]:
                    logger.info("Successfully uploaded model to Supabase Storage.")
                    # Return public URL or storage endpoint path
                    return f"{supabase_url.rstrip('/')}/storage/v1/object/public/{bucket_name}/{storage_path}"
                else:
                    logger.error(f"Supabase storage upload failed with status {response.status_code}: {response.text}")
        except Exception as e:
            logger.error(f"Exception while uploading to Supabase Storage: {e}")
            
        return None

    @classmethod
    def run_training(cls, brand_id: Optional[str] = None, niche: Optional[str] = None) -> Dict[str, Any]:
        """
        Executes the training pipeline.
        Steps:
        1. Fetch historical posts
        2. Preprocess features
        3. Train-Test Split (80:20)
        4. Label target Engagement Rate relative to train split percentiles (no data leakage)
        5. Fit RandomForest with regularization
        6. Evaluate and serialize model
        7. Upload to Supabase Storage and register in database
        """
        logger.info(f"Starting training pipeline for brand_id={brand_id}, niche={niche}")
        
        # 1. Fetch data
        df = cls.fetch_historical_data(brand_id, niche)
        
        # 2. Extract features
        X_df, feature_cols = DataPreprocessor.process_dataframe(df)
        y_er = df["er"].astype(float)
        
        # 3. Chronological Train-Test Split (80:20): posts arrive ordered by
        # created_at, so the model trains on older posts and is validated on
        # the newest ones — mirroring production use and avoiding the
        # look-ahead leakage a random split allows on time-ordered data.
        split_idx = int(len(X_df) * 0.8)
        X_train, X_test = X_df.iloc[:split_idx], X_df.iloc[split_idx:]
        y_er_train, y_er_test = y_er.iloc[:split_idx], y_er.iloc[split_idx:]
        
        # 4. Labeling via Percentiles (Calculated exclusively on training set to prevent leakage)
        p33, p67 = DataPreprocessor.calculate_percentile_bounds(y_er_train)
        logger.info(f"Percentile thresholds calculated on training split: P33={p33:.4f}, P67={p67:.4f}")
        
        y_train = y_er_train.apply(lambda er: DataPreprocessor.label_performance(er, p33, p67))
        y_test = y_er_test.apply(lambda er: DataPreprocessor.label_performance(er, p33, p67))

        # Guard against degenerate labeling (e.g. many identical engagement
        # rates collapsing every post into one class): a single-class model
        # cannot produce meaningful tier probabilities.
        if y_train.nunique() < 2:
            raise InsufficientDataError(
                "Cannot train: engagement rates are too uniform to derive "
                "HIGH/AVERAGE/LOW classes. Sync more varied historical data first."
            )

        # 5. Initialize RandomForest with regularization (max_depth, min_samples_leaf)
        # to avoid overfitting on small datasets
        model = RandomForestClassifier(
            n_estimators=100,
            max_depth=4,            # Restrict depth to avoid complex tree splits
            min_samples_leaf=5,     # Require at least 5 samples at leaf nodes
            random_state=42
        )
        
        # 6. Fit Model
        model.fit(X_train, y_train)
        
        # 7. Evaluate
        y_pred = model.predict(X_test)
        accuracy = accuracy_score(y_test, y_pred)
        precision, recall, f1, _ = precision_recall_fscore_support(y_test, y_pred, average="weighted", zero_division=0)
        
        metrics = {
            "accuracy": float(accuracy),
            "precision": float(precision),
            "recall": float(recall),
            "f1_score": float(f1),
            "p33_threshold": p33,
            "p67_threshold": p67,
            "train_samples": len(X_train),
            "test_samples": len(X_test),
            "split": "chronological_80_20"
        }
        logger.info(f"Model evaluation metrics: {metrics}")
        
        # Save model locally
        model_type = "account" if brand_id else "niche"
        version_str = datetime.datetime.utcnow().strftime("%Y%m%d%H%M%S")
        model_filename = f"model_{model_type}_{brand_id or niche}_{version_str}.joblib"
        local_path = os.path.join(CACHE_DIR, model_filename)
        
        # We save a dictionary containing both the model and the preprocessor bounds
        model_bundle = {
            "model": model,
            "p33": p33,
            "p67": p67,
            "features": feature_cols
        }
        joblib.dump(model_bundle, local_path)
        logger.info(f"Saved local model bundle to {local_path}")
        
        # Clean up older cached models to prevent disk space leaks (Fix 4.2)
        cls._cleanup_old_cached_models(model_type, str(brand_id or niche))
        
        # 8. Upload to Supabase Storage
        storage_path = f"{model_type}/{model_filename}"
        storage_url = cls.upload_to_supabase_storage(local_path, storage_path)
        
        if not storage_url:
            storage_url = f"file:///{local_path.replace(os.sep, '/')}"
            
        # 9. Register in models database table & update brand maturity
        conn = None
        try:
            conn = cls._get_db_connection()
            with conn.cursor() as cur:
                # Save models metadata
                cur.execute(
                    """
                    INSERT INTO models (brand_id, niche, model_type, storage_path, storage_url, version, accuracy, metrics)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        brand_id, 
                        niche, 
                        model_type, 
                        storage_path, 
                        storage_url, 
                        version_str, 
                        accuracy, 
                        json.dumps(metrics)
                    )
                )
                model_db_id = cur.fetchone()[0]
                
                # If personal model trained successfully and is account-specific, update brand type
                if brand_id and model_type == "account":
                    cur.execute(
                        "UPDATE brands SET model_type = 'personal' WHERE id = %s",
                        (brand_id,)
                    )
                conn.commit()
                logger.info(f"Registered model in DB with ID: {model_db_id}")
        except Exception as e:
            logger.warning(f"Could not write model details to database: {e}")
        finally:
            if conn:
                conn.close()
                
        return {
            "status": "success",
            "model_filename": model_filename,
            "storage_path": storage_path,
            "storage_url": storage_url,
            "metrics": metrics
        }
