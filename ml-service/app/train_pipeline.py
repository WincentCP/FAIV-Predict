import os
import re
import datetime
import logging
import json
import hashlib
import uuid
import platform
import joblib
import httpx
import numpy as np
import pandas as pd
import psycopg2
import sklearn
from psycopg2.extras import RealDictCursor
from typing import Optional, Tuple, Dict, Any, Iterable
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    cohen_kappa_score,
    confusion_matrix,
    mean_absolute_error,
    precision_recall_fscore_support,
)
from sklearn.model_selection import TimeSeriesSplit
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from app.preprocessing import DataPreprocessor

logger = logging.getLogger("train_pipeline")
logging.basicConfig(level=logging.INFO)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_DIR = os.path.join(BASE_DIR, "models_cache")
os.makedirs(CACHE_DIR, exist_ok=True)

# Shared cohort models can pool data across brands. A personal model needs a
# materially larger history so it does not overfit one account's small sample.
MIN_TRAINING_SAMPLES = 30
MIN_ACCOUNT_TRAINING_SAMPLES = 200
# Meta exposes cumulative engagement rather than a historical fixed-horizon
# snapshot in this prototype. Excluding posts younger than seven complete days
# avoids training on obviously immature labels while keeping the limitation
# explicit in the persisted evaluation contract.
MIN_POST_AGE_DAYS = 7
CANONICAL_CLASS_LABELS = ["LOW", "AVERAGE", "HIGH"]
ORDINAL_CLASS_VALUES = {"LOW": 0, "AVERAGE": 1, "HIGH": 2}
TEMPORAL_EVALUATION_SPLITS = 3
MIN_TEMPORAL_FOLD_TRAIN_SAMPLES = 12
PERMUTATION_IMPORTANCE_REPEATS = 10


def build_model_version() -> str:
    """Return a sortable, collision-resistant identifier for one training run."""
    return (
        datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d%H%M%S%f")
        + "_"
        + uuid.uuid4().hex[:8]
    )


def _class_distribution(values: Iterable[str]) -> Dict[str, int]:
    """Return a stable class-count mapping, including absent classes."""
    counts = pd.Series(list(values), dtype="object").value_counts()
    return {label: int(counts.get(label, 0)) for label in CANONICAL_CLASS_LABELS}


def _balanced_accuracy_value(y_true, y_pred) -> float:
    """Mean recall over classes observed in y_true, without warning noise."""
    _, recalls, _, supports = precision_recall_fscore_support(
        y_true,
        y_pred,
        labels=CANONICAL_CLASS_LABELS,
        average=None,
        zero_division=0,
    )
    observed_recalls = [
        float(recall)
        for recall, support in zip(recalls, supports)
        if int(support) > 0
    ]
    return float(np.mean(observed_recalls)) if observed_recalls else 0.0


def _permutation_balanced_accuracy_scorer(model, X, y) -> float:
    """Scikit-learn scorer signature backed by the warning-free metric."""
    return _balanced_accuracy_value(y, model.predict(X))


def build_classification_evidence(y_true, y_pred) -> Dict[str, Any]:
    """Build thesis-ready metrics without hiding weak minority-class results.

    Weighted metrics are retained for backwards compatibility, while macro and
    per-class metrics plus a fixed-label confusion matrix make the evaluation
    auditable even when the chronological test split omits a class.
    """
    precision_by_class, recall_by_class, f1_by_class, support_by_class = (
        precision_recall_fscore_support(
            y_true,
            y_pred,
            labels=CANONICAL_CLASS_LABELS,
            average=None,
            zero_division=0,
        )
    )
    weighted = precision_recall_fscore_support(
        y_true, y_pred, average="weighted", zero_division=0
    )
    macro = precision_recall_fscore_support(
        y_true,
        y_pred,
        labels=CANONICAL_CLASS_LABELS,
        average="macro",
        zero_division=0,
    )
    per_class = {
        label: {
            "precision": float(precision_by_class[index]),
            "recall": float(recall_by_class[index]),
            "f1_score": float(f1_by_class[index]),
            "support": int(support_by_class[index]),
        }
        for index, label in enumerate(CANONICAL_CLASS_LABELS)
    }
    true_ordinal = [ORDINAL_CLASS_VALUES[value] for value in y_true]
    predicted_ordinal = [ORDINAL_CLASS_VALUES[value] for value in y_pred]
    if len(set(true_ordinal) | set(predicted_ordinal)) < 2:
        quadratic_kappa = None
    else:
        quadratic_kappa = cohen_kappa_score(
            true_ordinal,
            predicted_ordinal,
            labels=list(ORDINAL_CLASS_VALUES.values()),
            weights="quadratic",
        )
    # Cohen's kappa is undefined when both vectors contain one identical class.
    # Persist null instead of non-standard JSON NaN so evidence remains portable.
    if quadratic_kappa is not None and not np.isfinite(quadratic_kappa):
        quadratic_kappa = None

    return {
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "balanced_accuracy": _balanced_accuracy_value(y_true, y_pred),
        "ordinal_mae": float(mean_absolute_error(true_ordinal, predicted_ordinal)),
        "quadratic_weighted_kappa": (
            float(quadratic_kappa) if quadratic_kappa is not None else None
        ),
        "weighted": {
            "precision": float(weighted[0]),
            "recall": float(weighted[1]),
            "f1_score": float(weighted[2]),
        },
        "macro": {
            "precision": float(macro[0]),
            "recall": float(macro[1]),
            "f1_score": float(macro[2]),
        },
        "per_class": per_class,
        "confusion_matrix": {
            "labels": list(CANONICAL_CLASS_LABELS),
            "matrix": confusion_matrix(
                y_true, y_pred, labels=CANONICAL_CLASS_LABELS
            ).astype(int).tolist(),
        },
    }


def _new_random_forest() -> RandomForestClassifier:
    """Return the production candidate with one centrally audited config."""
    return RandomForestClassifier(
        n_estimators=100,
        max_depth=4,
        min_samples_leaf=5,
        random_state=42,
    )


def _new_logistic_comparator() -> Pipeline:
    """Return a simple linear comparator, not a second production model.

    Scaling is fitted inside each temporal fold, preventing validation leakage.
    The comparator provides evidence that Random Forest is useful beyond both a
    majority guess and a conventional linear decision boundary.
    """
    return Pipeline([
        ("scale", StandardScaler()),
        ("classifier", LogisticRegression(max_iter=1000, random_state=42)),
    ])


def _metric_gains(candidate: Dict[str, Any], baseline: Dict[str, Any]) -> Dict[str, float]:
    """Return consistent candidate-minus-majority gains for every evaluation."""
    return {
        "accuracy": float(candidate["accuracy"] - baseline["accuracy"]),
        "balanced_accuracy": float(
            candidate["balanced_accuracy"] - baseline["balanced_accuracy"]
        ),
        "macro_f1": float(
            candidate["macro"]["f1_score"] - baseline["macro"]["f1_score"]
        ),
    }


def build_expanding_window_evidence(
    X: pd.DataFrame,
    y_er: pd.Series,
    *,
    requested_splits: int = TEMPORAL_EVALUATION_SPLITS,
) -> Dict[str, Any]:
    """Evaluate models on expanding windows inside the training portion only.

    Each fold recalculates P33/P67 exclusively from that fold's older training
    window. Small or tied folds are recorded as skipped rather than crashing a
    production retraining job. The newest 20% final holdout is never passed to
    this function and therefore remains untouched.
    """
    sample_count = len(X)
    result: Dict[str, Any] = {
        "method": "expanding_window_on_training_portion",
        "requested_splits": int(requested_splits),
        "minimum_fold_train_samples": MIN_TEMPORAL_FOLD_TRAIN_SAMPLES,
        "threshold_policy": "recomputed_from_each_fold_training_window",
        "folds": [],
    }
    if sample_count <= requested_splits:
        result["summary"] = {
            "evaluated_folds": 0,
            "skipped_folds": 0,
            "positive_gain_folds": 0,
            "sufficient_evidence": False,
            "majority_positive_gain": False,
            "status": "insufficient_history",
        }
        return result

    splitter = TimeSeriesSplit(n_splits=requested_splits)
    evaluated = 0
    skipped = 0
    positive_gain_folds = 0
    for fold_number, (fit_indices, validation_indices) in enumerate(
        splitter.split(X), start=1
    ):
        fold_record: Dict[str, Any] = {
            "fold": fold_number,
            "train_samples": int(len(fit_indices)),
            "validation_samples": int(len(validation_indices)),
            "train_end_index": int(fit_indices[-1]),
            "validation_start_index": int(validation_indices[0]),
            "validation_end_index": int(validation_indices[-1]),
        }
        if len(fit_indices) < MIN_TEMPORAL_FOLD_TRAIN_SAMPLES:
            fold_record.update({
                "status": "skipped",
                "reason": "training_window_too_small",
            })
            result["folds"].append(fold_record)
            skipped += 1
            continue

        fold_X_train = X.iloc[fit_indices]
        fold_X_validation = X.iloc[validation_indices]
        fold_er_train = y_er.iloc[fit_indices]
        fold_er_validation = y_er.iloc[validation_indices]
        fold_p33, fold_p67 = DataPreprocessor.calculate_percentile_bounds(
            fold_er_train
        )
        fold_y_train = fold_er_train.apply(
            lambda er: DataPreprocessor.label_performance(er, fold_p33, fold_p67)
        )
        fold_y_validation = fold_er_validation.apply(
            lambda er: DataPreprocessor.label_performance(er, fold_p33, fold_p67)
        )
        missing_train_classes = sorted(
            set(CANONICAL_CLASS_LABELS) - set(fold_y_train.unique())
        )
        if missing_train_classes:
            fold_record.update({
                "status": "skipped",
                "reason": "training_window_missing_classes",
                "missing_training_classes": missing_train_classes,
                "p33_threshold": float(fold_p33),
                "p67_threshold": float(fold_p67),
            })
            result["folds"].append(fold_record)
            skipped += 1
            continue

        candidate = _new_random_forest()
        candidate.fit(fold_X_train, fold_y_train)
        candidate_evidence = build_classification_evidence(
            fold_y_validation,
            candidate.predict(fold_X_validation),
        )
        baseline = DummyClassifier(strategy="most_frequent")
        baseline.fit(fold_X_train, fold_y_train)
        baseline_evidence = build_classification_evidence(
            fold_y_validation,
            baseline.predict(fold_X_validation),
        )
        linear = _new_logistic_comparator()
        linear.fit(fold_X_train, fold_y_train)
        linear_evidence = build_classification_evidence(
            fold_y_validation,
            linear.predict(fold_X_validation),
        )
        gains = _metric_gains(candidate_evidence, baseline_evidence)
        positive_gain = (
            gains["balanced_accuracy"] > 0 and gains["macro_f1"] > 0
        )
        positive_gain_folds += int(positive_gain)
        evaluated += 1
        missing_validation_classes = sorted(
            set(CANONICAL_CLASS_LABELS) - set(fold_y_validation.unique())
        )
        fold_record.update({
            "status": "evaluated",
            "p33_threshold": float(fold_p33),
            "p67_threshold": float(fold_p67),
            "train_class_distribution": _class_distribution(fold_y_train),
            "validation_class_distribution": _class_distribution(
                fold_y_validation
            ),
            "missing_validation_classes": missing_validation_classes,
            "candidate": candidate_evidence,
            "baseline": baseline_evidence,
            "logistic_regression": linear_evidence,
            "gains_over_baseline": gains,
            "positive_balanced_accuracy_and_macro_f1_gain": positive_gain,
        })
        result["folds"].append(fold_record)

    sufficient_evidence = evaluated >= 2
    majority_positive = (
        sufficient_evidence and positive_gain_folds > (evaluated / 2)
    )
    result["summary"] = {
        "evaluated_folds": evaluated,
        "skipped_folds": skipped,
        "positive_gain_folds": positive_gain_folds,
        "sufficient_evidence": sufficient_evidence,
        "majority_positive_gain": majority_positive,
        "status": "complete" if sufficient_evidence else "insufficient_history",
    }
    return result


def build_permutation_importance_evidence(
    model: RandomForestClassifier,
    X_test: pd.DataFrame,
    y_test: pd.Series,
) -> Dict[str, Any]:
    """Measure holdout feature importance without replacing production MDI."""
    try:
        measured = permutation_importance(
            model,
            X_test,
            y_test,
            scoring=_permutation_balanced_accuracy_scorer,
            n_repeats=PERMUTATION_IMPORTANCE_REPEATS,
            random_state=42,
            n_jobs=1,
        )
    except Exception as exc:  # Evidence failure must not discard a fitted model.
        logger.warning("Could not compute holdout permutation importance: %s", exc)
        return {
            "available": False,
            "scoring": "balanced_accuracy",
            "n_repeats": PERMUTATION_IMPORTANCE_REPEATS,
            "random_state": 42,
            "reason": type(exc).__name__,
            "features": [],
        }

    features = [
        {
            "feature": str(feature_name),
            "mean": float(measured.importances_mean[index]),
            "std": float(measured.importances_std[index]),
        }
        for index, feature_name in enumerate(X_test.columns)
    ]
    features.sort(key=lambda item: item["mean"], reverse=True)
    return {
        "available": True,
        "scoring": "balanced_accuracy",
        "n_repeats": PERMUTATION_IMPORTANCE_REPEATS,
        "random_state": 42,
        "features": features,
    }


def build_dataset_evidence(
    df: pd.DataFrame,
    features: pd.DataFrame,
    feature_order: Iterable[str],
) -> Dict[str, Any]:
    """Fingerprint the exact rows and derived features used for training.

    Raw captions are deliberately excluded from the persisted evidence. The
    canonical hash still changes when an identity, timestamp, engagement label,
    or model feature changes, allowing a thesis result to be reproduced and
    checked without exposing caption text in logs or reports.
    """
    feature_order = list(feature_order)
    manifest = []
    valid_dates = []
    for position, (_, row) in enumerate(df.iterrows()):
        timestamp = pd.to_datetime(row.get("created_at"), utc=True, errors="coerce")
        timestamp_value = None if pd.isna(timestamp) else timestamp.isoformat()
        if timestamp_value:
            valid_dates.append(timestamp)
        manifest.append({
            "brand_id": str(row.get("brand_id") or ""),
            "instagram_media_id": str(row.get("instagram_media_id") or ""),
            "created_at": timestamp_value,
            "engagement_rate": float(row.get("er")),
            "features": {
                name: float(features.iloc[position][name])
                for name in feature_order
            },
        })

    canonical = json.dumps(
        manifest,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return {
        "dataset_sha256": hashlib.sha256(canonical).hexdigest(),
        "verified_posts": len(manifest),
        "unique_media_ids": len({
            row["instagram_media_id"] for row in manifest
            if row["instagram_media_id"]
        }),
        "first_post_at": min(valid_dates).isoformat() if valid_dates else None,
        "last_post_at": max(valid_dates).isoformat() if valid_dates else None,
        "feature_order": feature_order,
    }


def training_code_sha256() -> str:
    """Fingerprint the training and feature-extraction implementation."""
    digest = hashlib.sha256()
    for filename in ("preprocessing.py", "train_pipeline.py"):
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), filename)
        digest.update(filename.encode("utf-8"))
        with open(path, "rb") as source:
            digest.update(source.read())
    return digest.hexdigest()


def runtime_evidence() -> Dict[str, Any]:
    """Capture dependency identity needed to interpret a serialized model."""
    requirements_path = os.path.join(BASE_DIR, "requirements.txt")
    requirements_hash = None
    if os.path.exists(requirements_path):
        with open(requirements_path, "rb") as requirements_file:
            requirements_hash = hashlib.sha256(requirements_file.read()).hexdigest()
    return {
        "python": platform.python_version(),
        "numpy": np.__version__,
        "pandas": pd.__version__,
        "scikit_learn": sklearn.__version__,
        "requirements_sha256": requirements_hash,
    }


class InsufficientDataError(Exception):
    """Raised when there is not enough real data to train a trustworthy model."""


class ModelQualityError(Exception):
    """Raised when an evaluated candidate is not eligible for promotion."""

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
                        evidence_file = old_file.removesuffix(".joblib") + ".evaluation.json"
                        if os.path.exists(evidence_file):
                            os.remove(evidence_file)
                        logger.info(f"Cleaned up old cached model file: {old_file}")
                    except Exception as fe:
                        logger.warning(f"Could not remove old cached model file {old_file}: {fe}")
        except Exception as e:
            logger.warning(f"Error cleaning up old cached models: {e}")

    @classmethod
    def _cleanup_rejected_evaluations(
        cls, model_type: str, identifier: str, keep_limit: int = 5
    ) -> None:
        """Bound local diagnostics that have no promoted joblib companion."""
        try:
            prefix = f"model_{model_type}_{identifier}_"
            files = []
            for filename in os.listdir(CACHE_DIR):
                if not (
                    filename.startswith(prefix)
                    and filename.endswith(".evaluation.json")
                ):
                    continue
                path = os.path.join(CACHE_DIR, filename)
                promoted_path = path.removesuffix(".evaluation.json") + ".joblib"
                if not os.path.exists(promoted_path):
                    files.append((path, os.path.getmtime(path)))
            files.sort(key=lambda item: item[1], reverse=True)
            for old_file, _ in files[keep_limit:]:
                os.remove(old_file)
                logger.info("Cleaned up old rejected evaluation: %s", old_file)
        except Exception as exc:
            logger.warning("Could not clean rejected evaluations: %s", exc)


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
                        SELECT brand_id, instagram_media_id, caption, er,
                               is_single_image, is_carousel, is_reels, post_hour,
                               follower_count_at_post, caption_length, hashtag_count,
                               has_cta, created_at
                        FROM posts
                        WHERE brand_id = %s
                          AND source = 'instagram_graph'
                          AND instagram_media_id IS NOT NULL
                          AND er IS NOT NULL
                          AND post_hour IS NOT NULL
                          AND created_at IS NOT NULL
                          AND created_at <= now() - (%s * interval '1 day')
                        ORDER BY created_at ASC, instagram_media_id ASC
                        """,
                        (brand_id, MIN_POST_AGE_DAYS)
                    )
                    data = [dict(row) for row in cur.fetchall()]
                elif niche:
                    logger.info(f"Querying historical posts for niche: {niche}")
                    cur.execute(
                        """
                        SELECT p.brand_id, p.instagram_media_id, p.caption, p.er,
                               p.is_single_image, p.is_carousel, p.is_reels, p.post_hour,
                               p.follower_count_at_post, p.caption_length,
                               p.hashtag_count, p.has_cta, p.created_at
                        FROM posts p
                        JOIN brands b ON p.brand_id = b.id
                        WHERE b.niche = %s
                          AND p.source = 'instagram_graph'
                          AND p.instagram_media_id IS NOT NULL
                          AND p.er IS NOT NULL
                          AND p.post_hour IS NOT NULL
                          AND p.created_at IS NOT NULL
                          AND p.created_at <= now() - (%s * interval '1 day')
                        ORDER BY p.created_at ASC, p.instagram_media_id ASC
                        """,
                        (niche, MIN_POST_AGE_DAYS)
                    )
                    data = [dict(row) for row in cur.fetchall()]
        except Exception as e:
            logger.error(f"Database query failed or is unconfigured: {e}")
            raise InsufficientDataError(
                "Cannot train: the historical posts database is unreachable. "
                "Configure DATABASE_URL and sync real data first."
            )
        finally:
            if conn:
                conn.close()

        required_samples = MIN_ACCOUNT_TRAINING_SAMPLES if brand_id else MIN_TRAINING_SAMPLES
        if len(data) < required_samples:
            raise InsufficientDataError(
                f"Cannot train: only {len(data)} real posts found for "
                f"{'brand ' + str(brand_id) if brand_id else 'niche ' + str(niche)}; "
                f"at least {required_samples} are required. Sync more data first."
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
        dataset_evidence = build_dataset_evidence(df, X_df, feature_cols)
        
        # 3. Chronological Train-Test Split (80:20): posts arrive ordered by
        # created_at, so the model trains on older posts and is validated on
        # the newest ones — mirroring production use and avoiding the
        # look-ahead leakage a random split allows on time-ordered data.
        split_idx = int(len(X_df) * 0.8)
        X_train, X_test = X_df.iloc[:split_idx], X_df.iloc[split_idx:]
        y_er_train, y_er_test = y_er.iloc[:split_idx], y_er.iloc[split_idx:]
        hour_counts = X_train["post_hour"].astype(int).value_counts().sort_index()
        post_hour_support = {
            str(int(hour)): int(count)
            for hour, count in hour_counts.items()
            if 0 <= int(hour) <= 23 and int(count) > 0
        }
        # Persist feasible comparison anchors from the training portion only.
        # Counterfactuals can then probe observed central values instead of
        # presenting arbitrary hard-coded caption/tag targets as data-driven.
        feature_reference_values = {
            "caption_length_median": float(X_train["caption_length"].median()),
            "hashtag_count_median": float(X_train["hashtag_count"].median()),
        }
        
        # 4. Labeling via Percentiles (Calculated exclusively on training set to prevent leakage)
        p33, p67 = DataPreprocessor.calculate_percentile_bounds(y_er_train)
        logger.info(f"Percentile thresholds calculated on training split: P33={p33:.4f}, P67={p67:.4f}")
        
        y_train = y_er_train.apply(lambda er: DataPreprocessor.label_performance(er, p33, p67))
        y_test = y_er_test.apply(lambda er: DataPreprocessor.label_performance(er, p33, p67))

        # This product promises three tiers. Percentile ties can collapse one
        # or more labels, so never silently deploy a binary/single-class model
        # behind a three-tier UI.
        missing_train_classes = sorted(
            set(CANONICAL_CLASS_LABELS) - set(y_train.unique())
        )
        if missing_train_classes:
            raise InsufficientDataError(
                "Cannot train a three-tier model: the training split has no "
                f"{', '.join(missing_train_classes)} class after percentile labeling. "
                "Sync more varied historical data first."
            )

        # 5. Initialize RandomForest with regularization. The same factory is
        # used by inner temporal folds so the evidence matches the deployed
        # candidate exactly.
        model = _new_random_forest()
        
        # 6. Fit Model
        model.fit(X_train, y_train)
        
        # 7. Evaluate the candidate and a transparent majority-class baseline.
        # A thesis result must demonstrate that the trained classifier adds
        # value beyond always selecting the most common training label.
        y_pred = model.predict(X_test)
        candidate_evidence = build_classification_evidence(y_test, y_pred)
        baseline = DummyClassifier(strategy="most_frequent")
        baseline.fit(X_train, y_train)
        baseline_pred = baseline.predict(X_test)
        baseline_evidence = build_classification_evidence(y_test, baseline_pred)
        logistic_comparator = _new_logistic_comparator()
        logistic_comparator.fit(X_train, y_train)
        logistic_evidence = build_classification_evidence(
            y_test,
            logistic_comparator.predict(X_test),
        )
        temporal_evaluation = build_expanding_window_evidence(
            X_train.reset_index(drop=True),
            y_er_train.reset_index(drop=True),
        )
        holdout_permutation_importance = build_permutation_importance_evidence(
            model,
            X_test,
            y_test,
        )
        accuracy = candidate_evidence["accuracy"]
        gains_over_baseline = _metric_gains(candidate_evidence, baseline_evidence)
        accuracy_gain = gains_over_baseline["accuracy"]
        missing_test_classes = sorted(
            set(CANONICAL_CLASS_LABELS) - set(y_test.unique())
        )
        zero_recall_classes = sorted(
            label
            for label in CANONICAL_CLASS_LABELS
            if candidate_evidence["per_class"][label]["support"] > 0
            and candidate_evidence["per_class"][label]["recall"] <= 0
        )
        temporal_summary = temporal_evaluation["summary"]

        # Operational continuity and scientific validation are intentionally
        # separate. A useful model may remain available when history is too
        # small for a defensible three-class claim, but the UI/evidence must
        # label it exploratory rather than silently calling it validated.
        promotion_passed = accuracy_gain > 0
        scientific_criteria = {
            "operational_promotion_passed": promotion_passed,
            "all_held_out_classes_present": not missing_test_classes,
            "no_zero_recall_for_observed_classes": not zero_recall_classes,
            "balanced_accuracy_gain_over_baseline_gt_zero": (
                gains_over_baseline["balanced_accuracy"] > 0
            ),
            "macro_f1_gain_over_baseline_gt_zero": (
                gains_over_baseline["macro_f1"] > 0
            ),
            "at_least_two_temporal_folds_evaluated": bool(
                temporal_summary["sufficient_evidence"]
            ),
            "positive_gain_on_majority_of_temporal_folds": bool(
                temporal_summary["majority_positive_gain"]
            ),
        }
        scientific_passed = all(scientific_criteria.values())
        evaluation_status = "validated" if scientific_passed else "exploratory"
        scientific_reasons = [
            criterion
            for criterion, passed in scientific_criteria.items()
            if not passed
        ]

        warnings = []
        if missing_test_classes:
            warnings.append(
                "held_out_split_missing_classes:" + ",".join(missing_test_classes)
            )
        if zero_recall_classes:
            warnings.append(
                "held_out_zero_recall_classes:" + ",".join(zero_recall_classes)
            )
        if not temporal_summary["sufficient_evidence"]:
            warnings.append("insufficient_evaluable_temporal_folds")
        elif not temporal_summary["majority_positive_gain"]:
            warnings.append("temporal_majority_gain_not_demonstrated")

        metrics = {
            # Compatibility fields consumed by the existing UI.
            "accuracy": accuracy,
            "precision": candidate_evidence["weighted"]["precision"],
            "recall": candidate_evidence["weighted"]["recall"],
            "f1_score": candidate_evidence["weighted"]["f1_score"],
            # Complete academic evidence.
            "candidate": candidate_evidence,
            "baseline": {
                "model": "DummyClassifier",
                "strategy": "most_frequent",
                **baseline_evidence,
            },
            "comparators": {
                "logistic_regression": {
                    "model": "LogisticRegression",
                    "preprocessing": "StandardScaler_fit_on_training_only",
                    "parameters": {
                        "max_iter": 1000,
                        "random_state": 42,
                    },
                    **logistic_evidence,
                }
            },
            "accuracy_gain_over_baseline": accuracy_gain,
            "balanced_accuracy_gain_over_baseline": gains_over_baseline[
                "balanced_accuracy"
            ],
            "macro_f1_gain_over_baseline": gains_over_baseline["macro_f1"],
            "promotion_gate": {
                "passed": promotion_passed,
                "hard_criteria": {
                    "accuracy_gain_over_majority_baseline_gt_zero": promotion_passed,
                    "all_training_classes_present": True,
                },
                "warnings": warnings,
                "decision": "promote" if promotion_passed else "reject_keep_previous",
            },
            "scientific_gate": {
                "passed": scientific_passed,
                "hard_criteria": scientific_criteria,
                "failure_reasons": scientific_reasons,
                "decision": (
                    "validated_for_thesis_claim"
                    if scientific_passed
                    else "exploratory_limit_claims"
                ),
                "missing_held_out_classes": missing_test_classes,
                "zero_recall_classes": zero_recall_classes,
            },
            "evaluation_status": evaluation_status,
            "temporal_evaluation": temporal_evaluation,
            "holdout_permutation_importance": holdout_permutation_importance,
            "p33_threshold": p33,
            "p67_threshold": p67,
            "train_samples": len(X_train),
            "test_samples": len(X_test),
            "train_class_distribution": _class_distribution(y_train),
            "test_class_distribution": _class_distribution(y_test),
            "post_hour_support": post_hour_support,
            "feature_reference_values": feature_reference_values,
            "split": "chronological_80_20",
            "data_source": "instagram_graph",
            "identity_key": "instagram_media_id",
            "minimum_post_age_days": MIN_POST_AGE_DAYS,
            "engagement_observation_policy": "cumulative_at_latest_sync_after_maturity_gate",
            "verified_posts": len(df),
            "dataset": dataset_evidence,
            "training_code_sha256": training_code_sha256(),
            "runtime": runtime_evidence(),
            "model_parameters": model.get_params(deep=False),
            "evaluation_contract": "faiv-thesis-v2",
        }
        logger.info(f"Model evaluation metrics: {metrics}")
        
        # Save model locally
        model_type = "account" if brand_id else "niche"
        # Microseconds plus random entropy prevent simultaneous retraining jobs
        # from overwriting one another's storage object or cache entry.
        version_str = build_model_version()
        model_filename = f"model_{model_type}_{brand_id or niche}_{version_str}.joblib"
        local_path = os.path.join(CACHE_DIR, model_filename)

        # Persist the evaluation before the promotion decision. A rejected
        # candidate remains auditable locally without becoming the active model.
        evaluation_filename = model_filename.replace(".joblib", ".evaluation.json")
        evaluation_path = os.path.join(CACHE_DIR, evaluation_filename)
        with open(evaluation_path, "w", encoding="utf-8") as evaluation_file:
            json.dump(metrics, evaluation_file, ensure_ascii=False, indent=2)
        logger.info(f"Saved evaluation evidence to {evaluation_path}")

        if not promotion_passed:
            cls._cleanup_rejected_evaluations(
                model_type, str(brand_id or niche)
            )
            raise ModelQualityError(
                "Candidate rejected: held-out accuracy did not beat the "
                f"majority-class baseline (gain={accuracy_gain:.4f}). "
                f"Evidence: {evaluation_filename}. The previous model remains active."
            )
        
        # We save a dictionary containing both the model and the preprocessor bounds
        model_bundle = {
            "model": model,
            "p33": p33,
            "p67": p67,
            "features": feature_cols,
            "feature_ranges": DataPreprocessor.compute_feature_ranges(X_train),
            "post_hour_support": post_hour_support,
            "feature_reference_values": feature_reference_values,
            "evaluation": metrics,
            "data_provenance": {
                "source": "instagram_graph",
                "identity_key": "instagram_media_id",
                "minimum_post_age_days": MIN_POST_AGE_DAYS,
                "engagement_observation_policy": "cumulative_at_latest_sync_after_maturity_gate",
                "verified_posts": len(df),
                **dataset_evidence,
            },
        }
        joblib.dump(model_bundle, local_path)
        logger.info(f"Saved local model bundle to {local_path}")
        
        # 8. Upload to Supabase Storage
        storage_path = f"{model_type}/{model_filename}"
        storage_url = cls.upload_to_supabase_storage(local_path, storage_path)
        
        if not storage_url:
            raise RuntimeError(
                "Training produced a model, but the artifact could not be stored durably. "
                "No model was registered."
            )
            
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
            logger.error(f"Could not register model details in database: {e}")
            raise RuntimeError("Model artifact exists, but database registration failed.") from e
        finally:
            if conn:
                conn.close()

        # Retire old cache files only after the new artifact is durable and its
        # metadata transaction committed. A failed candidate must not evict a
        # previously working local model.
        cls._cleanup_old_cached_models(model_type, str(brand_id or niche))
                
        return {
            "status": "success",
            "model_filename": model_filename,
            "evaluation_filename": evaluation_filename,
            "storage_path": storage_path,
            "storage_url": storage_url,
            "metrics": metrics
        }
