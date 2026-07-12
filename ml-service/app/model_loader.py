import os
import re
import tempfile
import joblib
import httpx
import logging
import psycopg2
from psycopg2.extras import RealDictCursor
from typing import Optional, Any, Tuple

from app.preprocessing import FEATURE_ORDER_V1

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
    Fails closed when storage or database configuration is unavailable.
    """
    
    _model_cache = {}

    @staticmethod
    def _safe_cache_component(value: Any, *, fallback: str) -> str:
        """Return a readable filename component that cannot escape CACHE_DIR."""
        raw = str(value or "")
        normalized = re.sub(r"[^A-Za-z0-9._-]+", "_", raw).strip("._-")[:80]
        return normalized or fallback

    @classmethod
    def _cache_filename(
        cls, model_type: Any, identifier: Any, version: Any
    ) -> str:
        return "model_{}_{}_{}.joblib".format(
            cls._safe_cache_component(model_type, fallback="unknown"),
            cls._safe_cache_component(identifier, fallback="scope"),
            cls._safe_cache_component(version, fallback="version"),
        )

    @staticmethod
    def _validate_model_bundle(bundle: Any) -> None:
        """Fail closed when a registered artifact does not match inference."""
        if not isinstance(bundle, dict):
            raise ModelUnavailableError(
                "The registered model artifact has an unsupported structure. Retrain it."
            )
        provenance = bundle.get("data_provenance")
        if not isinstance(provenance, dict) or (
            provenance.get("source") != "instagram_graph"
            or provenance.get("identity_key") != "instagram_media_id"
        ):
            raise ModelUnavailableError(
                "The model artifact predates verified Instagram media provenance. Retrain it before serving."
            )

        model = bundle.get("model")
        classes = getattr(model, "classes_", None)
        if not callable(getattr(model, "predict_proba", None)) or classes is None:
            raise ModelUnavailableError(
                "The registered model artifact is incomplete. Retrain it before serving."
            )
        if {str(value).upper() for value in classes} != {"LOW", "AVERAGE", "HIGH"}:
            raise ModelUnavailableError(
                "The registered model artifact does not implement the required three tiers. Retrain it."
            )

        features = bundle.get("features")
        if features is not None and (
            not isinstance(features, list)
            or not features
            or any(not isinstance(name, str) or not name for name in features)
            or len(set(features)) != len(features)
        ):
            raise ModelUnavailableError(
                "The registered model artifact has an invalid feature schema. Retrain it."
            )
        expected_feature_count = len(features or FEATURE_ORDER_V1)
        fitted_feature_count = getattr(model, "n_features_in_", expected_feature_count)
        if int(fitted_feature_count) != expected_feature_count:
            raise ModelUnavailableError(
                "The registered model artifact feature schema is incompatible. Retrain it."
            )
    
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
                effective_niche = niche
                if brand_id:
                    cur.execute(
                        """
                        SELECT m.id, m.brand_id, m.niche, m.model_type,
                               m.storage_path, m.storage_url, m.version,
                               m.accuracy, m.metrics
                        FROM models m
                        JOIN brands b ON b.id = m.brand_id
                        WHERE m.brand_id = %s AND b.owner_id IS NOT NULL
                          AND m.model_type = 'account'
                          AND m.metrics->>'data_source' = 'instagram_graph'
                          AND m.metrics->>'identity_key' = 'instagram_media_id'
                          AND m.metrics->>'evaluation_contract' IN ('faiv-thesis-v1', 'faiv-thesis-v2')
                          AND m.metrics->'promotion_gate'->>'passed' = 'true'
                        ORDER BY m.created_at DESC LIMIT 1
                        """,
                        (brand_id,)
                    )
                    row = cur.fetchone()
                    if row:
                        return dict(row)

                    # Cohort fallback is derived from the persisted brand, not
                    # from a caller-provided niche that could reference a
                    # different scope.
                    cur.execute(
                        """SELECT niche FROM brands
                           WHERE id = %s AND owner_id IS NOT NULL LIMIT 1""",
                        (brand_id,),
                    )
                    brand = cur.fetchone()
                    if not brand:
                        return None
                    effective_niche = brand.get("niche")

                if effective_niche:
                    cur.execute(
                        """
                        SELECT id, brand_id, niche, model_type, storage_path, storage_url, version, accuracy, metrics
                        FROM models 
                        WHERE niche = %s AND model_type = 'niche' AND brand_id IS NULL
                          AND metrics->>'data_source' = 'instagram_graph'
                          AND metrics->>'identity_key' = 'instagram_media_id'
                          AND metrics->>'evaluation_contract' IN ('faiv-thesis-v1', 'faiv-thesis-v2')
                          AND metrics->'promotion_gate'->>'passed' = 'true'
                        ORDER BY created_at DESC LIMIT 1
                        """,
                        (effective_niche,)
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
        if os.path.basename(filename) != filename:
            raise ValueError("Model cache filename must not contain a path")
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
                headers["apikey"] = supabase_key
                if not supabase_key.startswith(("sb_secret_", "sb_publishable_")):
                    headers["Authorization"] = f"Bearer {supabase_key}"

        logger.info("Downloading registered model artifact: %s", filename)
        temporary_path = None
        try:
            with httpx.Client(timeout=15.0) as client:
                response = client.get(download_url, headers=headers)
                if response.status_code == 200:
                    with tempfile.NamedTemporaryFile(
                        mode="wb", dir=CACHE_DIR, prefix=".model-", delete=False
                    ) as temporary_file:
                        temporary_path = temporary_file.name
                        temporary_file.write(response.content)
                    os.replace(temporary_path, local_path)
                    temporary_path = None
                    logger.info("Model artifact cached: %s", filename)
                    return local_path
                raise IOError(
                    f"Supabase Storage returned status code {response.status_code}"
                )
        except Exception as exc:
            logger.error("Failed to download model artifact: %s", type(exc).__name__)
            raise
        finally:
            if temporary_path and os.path.exists(temporary_path):
                os.remove(temporary_path)

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

        identifier = (
            metadata.get("brand_id")
            or metadata.get("niche")
            or brand_id
            or niche
        )
        filename = cls._cache_filename(model_type, identifier, version)
        cache_key = f"{metadata.get('id') or identifier}_{version}"

        # Check RAM cache first
        if cache_key in cls._model_cache:
            logger.info(f"Model {filename} loaded from memory cache.")
            return cls._model_cache[cache_key], metadata

        try:
            local_path = cls.download_model(storage_url, storage_path, filename)
            bundle = joblib.load(local_path)
            cls._validate_model_bundle(bundle)
            cls._model_cache[cache_key] = bundle
            logger.info(f"Successfully loaded model {filename} and cached in memory.")
            return bundle, metadata
        except ModelUnavailableError:
            # Provenance failures are already intentionally worded for callers.
            raise
        except Exception:
            logger.exception("Error loading model from storage")
            raise ModelUnavailableError(
                "A trained model is registered but its artifact is temporarily unavailable."
            )
