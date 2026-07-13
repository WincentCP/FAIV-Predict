"""Prediction API router and model-derived counterfactual analysis."""

import datetime
import hashlib
import json
import os
import uuid
from typing import Any, Dict

import numpy as np
import psycopg2
import psycopg2.extras
from fastapi import APIRouter, Depends, HTTPException

from app.model_loader import ModelLoader, ModelUnavailableError
from app.preprocessing import DataPreprocessor, FEATURE_ORDER_V1
from app.shared import PredictionRequest, UNKNOWN_TIME_SCENARIOS, logger, verify_internal_token

router = APIRouter()


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


@router.post("/predict", dependencies=[Depends(verify_internal_token)])
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
