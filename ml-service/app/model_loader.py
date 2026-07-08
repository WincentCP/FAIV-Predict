import os
import joblib
import httpx
import logging
import psycopg2
from psycopg2.extras import RealDictCursor
from typing import Optional, Any, Tuple

logger = logging.getLogger("model_loader")
logging.basicConfig(level=logging.INFO)

# Base directories
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_DIR = os.path.join(BASE_DIR, "models_cache")
os.makedirs(CACHE_DIR, exist_ok=True)


class ModelUnavailableError(Exception):
    """Raised when no real trained model is available for the requested scope."""


class ModelLoader:
    """
    Manages caching, fetching, and loading of Random Forest models from Supabase Storage.
    Includes robust fallbacks for offline or unconfigured environments.
    """
    
    _model_cache = {}
    
    @staticmethod
    def _get_db_connection():
        """Creates a PostgreSQL connection to Supabase using DATABASE_URL."""
        db_url = os.getenv("DATABASE_URL")
        if not db_url:
            raise ValueError("DATABASE_URL environment variable is not set.")
        return psycopg2.connect(db_url)

    @classmethod
    def get_model_metadata(cls, brand_id: Optional[str] = None, niche: Optional[str] = None) -> Optional[dict]:
        """
        Queries the database for the latest model metadata for a brand or niche.
        Checks for:
        - brand_id (Personal model) if brand_id is provided.
        - niche (Niche model) if niche is provided or if personal model is not found.
        """
        conn = None
        try:
            conn = cls._get_db_connection()
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                if brand_id:
                    # Look for active brand-specific model first
                    cur.execute(
                        """
                        SELECT id, brand_id, niche, model_type, storage_path, storage_url, version, metrics 
                        FROM models 
                        WHERE brand_id = %s AND model_type = 'account'
                        ORDER BY created_at DESC LIMIT 1
                        """,
                        (brand_id,)
                    )
                    row = cur.fetchone()
                    if row:
                        return dict(row)
                
                if niche:
                    # Look for shared niche model
                    cur.execute(
                        """
                        SELECT id, brand_id, niche, model_type, storage_path, storage_url, version, metrics 
                        FROM models 
                        WHERE niche = %s AND model_type = 'niche' AND brand_id IS NULL
                        ORDER BY created_at DESC LIMIT 1
                        """,
                        (niche,)
                    )
                    row = cur.fetchone()
                    if row:
                        return dict(row)
        except Exception as e:
            logger.error(f"Failed to fetch model metadata from DB: {e}")
        finally:
            if conn:
                conn.close()
        return None

    @classmethod
    def download_model(cls, storage_url: str, storage_path: str, filename: str) -> str:
        """
        Downloads the joblib model from Supabase Storage and returns the local file path.
        Uses Supabase environment variables for authorization if needed.
        """
        local_path = os.path.join(CACHE_DIR, filename)
        
        # If already cached locally, return it
        if os.path.exists(local_path):
            logger.info(f"Model file {filename} found in local cache.")
            return local_path

        supabase_url = os.getenv("SUPABASE_URL")
        supabase_key = os.getenv("SUPABASE_KEY")
        
        # Construct download URL if URL is not fully qualified or needs authorization
        headers = {}
        download_url = storage_url
        
        if supabase_url and supabase_key and storage_path:
            if not storage_url or "supabase" in supabase_url:
                bucket_name = "models"
                download_url = f"{supabase_url.rstrip('/')}/storage/v1/object/authenticated/{bucket_name}/{storage_path.lstrip('/')}"
                headers["Authorization"] = f"Bearer {supabase_key}"

        logger.info(f"Downloading model from {download_url}...")
        try:
            with httpx.Client(timeout=15.0) as client:
                response = client.get(download_url, headers=headers)
                if response.status_code == 200:
                    with open(local_path, "wb") as f:
                        f.write(response.content)
                    logger.info(f"Successfully downloaded model to {local_path}")
                    return local_path
                else:
                    raise IOError(f"Supabase Storage returned status code {response.status_code}: {response.text}")
        except Exception as e:
            logger.error(f"Failed to download model: {e}")
            raise

    @classmethod
    def load_model(cls, brand_id: Optional[str] = None, niche: Optional[str] = None) -> Tuple[Any, dict]:
        """
        Loads the appropriate real trained model (personal or niche-level) from the
        database/storage. Returns a tuple of (model_bundle, metadata_dict).

        Raises ModelUnavailableError if the database is unreachable or no trained
        model exists for the requested brand/niche. We never serve a fabricated
        fallback model, so callers can surface an honest "no model yet" state.
        """
        if not os.getenv("DATABASE_URL"):
            raise ModelUnavailableError(
                "No model available: DATABASE_URL is not configured."
            )

        metadata = cls.get_model_metadata(brand_id, niche)
        if not metadata:
            raise ModelUnavailableError(
                f"No trained model found for "
                f"{'brand ' + str(brand_id) if brand_id else 'niche ' + str(niche)}. "
                "Train a model on real data first."
            )

        storage_url = metadata.get("storage_url", "")
        storage_path = metadata.get("storage_path", "")
        version = metadata.get("version", "v1.0")
        model_type = metadata.get("model_type", "niche")

        filename = f"model_{model_type}_{brand_id or niche}_{version}.joblib"
        cache_key = f"{brand_id or niche}_{version}"

        # Check RAM cache first
        if cache_key in cls._model_cache:
            logger.info(f"Model {filename} loaded from memory cache.")
            return cls._model_cache[cache_key], metadata

        try:
            local_path = cls.download_model(storage_url, storage_path, filename)
            model = joblib.load(local_path)
            cls._model_cache[cache_key] = model
            logger.info(f"Successfully loaded model {filename} and cached in memory.")
            return model, metadata
        except Exception as e:
            logger.error(f"Error loading model from storage: {e}")
            raise ModelUnavailableError(
                f"A model is registered but its artifact could not be loaded: {e}"
            )
