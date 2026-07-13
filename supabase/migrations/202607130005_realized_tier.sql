-- Versioned realized-tier contract for verified mature publication outcomes.
-- `actual_class` remains quarantined legacy evidence. New categorical outcomes
-- use the exact training-split thresholds of the model that served the
-- prediction, referenced immutably by predictions.model_id.

ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS realized_class VARCHAR(10),
  ADD COLUMN IF NOT EXISTS realized_class_basis JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'predictions_realized_class_check'
      AND conrelid = 'public.predictions'::regclass
  ) THEN
    ALTER TABLE public.predictions
      ADD CONSTRAINT predictions_realized_class_check
      CHECK (
        realized_class IS NULL
        OR realized_class IN ('LOW', 'AVERAGE', 'HIGH')
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'predictions_realized_basis_pair_check'
      AND conrelid = 'public.predictions'::regclass
  ) THEN
    ALTER TABLE public.predictions
      ADD CONSTRAINT predictions_realized_basis_pair_check
      CHECK (
        (realized_class IS NULL AND realized_class_basis IS NULL)
        OR (
          realized_class IS NOT NULL
          AND jsonb_typeof(realized_class_basis) = 'object'
          AND realized_class_basis ?& ARRAY[
            'model_id', 'p33_threshold', 'p67_threshold', 'computed_at'
          ]
          AND jsonb_typeof(realized_class_basis->'model_id') = 'string'
          AND jsonb_typeof(realized_class_basis->'p33_threshold') = 'number'
          AND jsonb_typeof(realized_class_basis->'p67_threshold') = 'number'
          AND jsonb_typeof(realized_class_basis->'computed_at') = 'string'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_predictions_realized_outcomes
  ON public.predictions(created_by, realized_class, created_at DESC)
  WHERE realized_class IS NOT NULL;

COMMENT ON COLUMN public.predictions.realized_class IS
  'Verified mature cumulative-ER tier under the exact thresholds of the model that served this prediction.';
COMMENT ON COLUMN public.predictions.realized_class_basis IS
  'Immutable computation basis: serving model ID, training P33/P67, computation time, and maturity policy.';

CREATE OR REPLACE FUNCTION public.validate_prediction_observed_outcome()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  verified_er NUMERIC;
  model_p33 NUMERIC;
  model_p67 NUMERIC;
  expected_class TEXT;
  basis_computed_at TIMESTAMPTZ;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.actual_er IS NOT NULL
      OR NEW.actual_source IS NOT NULL
      OR NEW.actual_class IS NOT NULL
      OR NEW.realized_class IS NOT NULL
      OR NEW.realized_class_basis IS NOT NULL THEN
      RAISE EXCEPTION 'Observed outcomes may only be attached through a verified publication link.'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.actual_class IS DISTINCT FROM OLD.actual_class THEN
    RAISE EXCEPTION 'actual_class is retained only as legacy evidence and cannot be derived or changed.'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.actual_er IS NOT DISTINCT FROM OLD.actual_er
    AND NEW.actual_source IS NOT DISTINCT FROM OLD.actual_source
    AND NEW.realized_class IS NOT DISTINCT FROM OLD.realized_class
    AND NEW.realized_class_basis IS NOT DISTINCT FROM OLD.realized_class_basis THEN
    RETURN NEW;
  END IF;
  IF NEW.actual_source IS DISTINCT FROM 'instagram_media_id' THEN
    RAISE EXCEPTION 'Observed outcomes cannot be written or cleared outside a verified publication reconciliation.'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.actual_class IS NOT NULL THEN
    RAISE EXCEPTION 'actual_class is legacy-only; verified tiers use realized_class with a versioned basis.'
      USING ERRCODE = '23514';
  END IF;

  SELECT post.er INTO verified_er
  FROM public.prediction_publications publication
  JOIN public.posts post ON post.id = publication.post_id
  WHERE publication.prediction_id = NEW.id
    AND post.brand_id = NEW.brand_id
    AND post.source = 'instagram_graph'
    AND post.instagram_media_id = publication.instagram_media_id
    AND post.er IS NOT NULL
    AND post.created_at IS NOT NULL
    AND post.created_at <= now() - (7 * interval '1 day');
  IF NOT FOUND OR NEW.actual_er IS DISTINCT FROM verified_er THEN
    RAISE EXCEPTION 'Verified outcome must equal a linked mature Instagram post ER.'
      USING ERRCODE = '23514';
  END IF;

  SELECT
    CASE WHEN jsonb_typeof(model.metrics->'p33_threshold') = 'number'
      THEN (model.metrics->>'p33_threshold')::NUMERIC END,
    CASE WHEN jsonb_typeof(model.metrics->'p67_threshold') = 'number'
      THEN (model.metrics->>'p67_threshold')::NUMERIC END
  INTO model_p33, model_p67
  FROM public.models model
  WHERE model.id = NEW.model_id;

  IF model_p33 IS NULL OR model_p67 IS NULL OR model_p33 > model_p67 THEN
    IF NEW.realized_class IS NOT NULL OR NEW.realized_class_basis IS NOT NULL THEN
      RAISE EXCEPTION 'A realized tier requires valid persisted thresholds from the serving model.'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  expected_class := CASE
    WHEN NEW.actual_er < model_p33 THEN 'LOW'
    WHEN NEW.actual_er <= model_p67 THEN 'AVERAGE'
    ELSE 'HIGH'
  END;
  IF NEW.realized_class IS DISTINCT FROM expected_class THEN
    RAISE EXCEPTION 'Realized tier does not match the serving model thresholds.'
      USING ERRCODE = '23514';
  END IF;
  IF jsonb_typeof(NEW.realized_class_basis) IS DISTINCT FROM 'object'
    OR NEW.realized_class_basis->>'model_id' IS DISTINCT FROM NEW.model_id::TEXT
    OR jsonb_typeof(NEW.realized_class_basis->'p33_threshold') IS DISTINCT FROM 'number'
    OR (NEW.realized_class_basis->>'p33_threshold')::NUMERIC IS DISTINCT FROM model_p33
    OR jsonb_typeof(NEW.realized_class_basis->'p67_threshold') IS DISTINCT FROM 'number'
    OR (NEW.realized_class_basis->>'p67_threshold')::NUMERIC IS DISTINCT FROM model_p67
    OR jsonb_typeof(NEW.realized_class_basis->'computed_at') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'Realized tier basis does not match the serving model metadata.'
      USING ERRCODE = '23514';
  END IF;
  BEGIN
    basis_computed_at := (NEW.realized_class_basis->>'computed_at')::TIMESTAMPTZ;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'Realized tier basis has an invalid computation timestamp.'
      USING ERRCODE = '23514';
  END;
  IF basis_computed_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'Realized tier basis computation timestamp cannot be in the future.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS predictions_validate_observed_outcome ON public.predictions;
CREATE TRIGGER predictions_validate_observed_outcome
BEFORE UPDATE OF actual_er, actual_source, actual_class, realized_class, realized_class_basis
ON public.predictions
FOR EACH ROW
EXECUTE FUNCTION public.validate_prediction_observed_outcome();
DROP TRIGGER IF EXISTS predictions_validate_initial_outcome ON public.predictions;
CREATE TRIGGER predictions_validate_initial_outcome
BEFORE INSERT ON public.predictions
FOR EACH ROW
EXECUTE FUNCTION public.validate_prediction_observed_outcome();

CREATE OR REPLACE FUNCTION public.audit_prediction_observed_outcome()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.actual_er IS NOT DISTINCT FROM NEW.actual_er
    AND OLD.actual_source IS NOT DISTINCT FROM NEW.actual_source
    AND OLD.realized_class IS NOT DISTINCT FROM NEW.realized_class
    AND OLD.realized_class_basis IS NOT DISTINCT FROM NEW.realized_class_basis THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.content_lifecycle_events (
    owner_id, brand_id, prediction_id, event_type, source, actor_id, metadata
  ) VALUES (
    NEW.created_by,
    NEW.brand_id,
    NEW.id,
    CASE WHEN OLD.actual_source IS NULL
      THEN 'prediction.outcome_observed'
      ELSE 'prediction.outcome_refreshed'
    END,
    'database_trigger',
    NULL,
    jsonb_strip_nulls(jsonb_build_object(
      'previous_actual_er', OLD.actual_er,
      'actual_er', NEW.actual_er,
      'actual_source', NEW.actual_source,
      'previous_realized_class', OLD.realized_class,
      'realized_class', NEW.realized_class,
      'realized_class_basis', NEW.realized_class_basis
    ))
  );
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS predictions_audit_observed_outcome ON public.predictions;
CREATE TRIGGER predictions_audit_observed_outcome
AFTER UPDATE OF actual_er, actual_source, realized_class, realized_class_basis
ON public.predictions
FOR EACH ROW
EXECUTE FUNCTION public.audit_prediction_observed_outcome();

CREATE OR REPLACE FUNCTION public.reconcile_prediction_publication_outcomes(
  p_brand_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  changed_count INTEGER := 0;
BEGIN
  WITH raw_eligible AS (
    SELECT publication.prediction_id,
           post.er,
           prediction.model_id,
           prediction.model_version,
           CASE WHEN jsonb_typeof(model.metrics->'p33_threshold') = 'number'
             THEN (model.metrics->>'p33_threshold')::NUMERIC END AS p33,
           CASE WHEN jsonb_typeof(model.metrics->'p67_threshold') = 'number'
             THEN (model.metrics->>'p67_threshold')::NUMERIC END AS p67
    FROM public.prediction_publications publication
    JOIN public.posts post ON post.id = publication.post_id
    JOIN public.predictions prediction ON prediction.id = publication.prediction_id
    LEFT JOIN public.models model ON model.id = prediction.model_id
    WHERE (p_brand_id IS NULL OR publication.brand_id = p_brand_id)
      AND prediction.actual_class IS NULL
      AND post.brand_id = publication.brand_id
      AND post.source = 'instagram_graph'
      AND post.instagram_media_id = publication.instagram_media_id
      AND post.er IS NOT NULL
      AND post.created_at IS NOT NULL
      AND post.created_at <= now() - (7 * interval '1 day')
  ), eligible AS (
    SELECT raw_eligible.*,
           CASE
             WHEN model_id IS NULL OR p33 IS NULL OR p67 IS NULL OR p33 > p67 THEN NULL
             WHEN er < p33 THEN 'LOW'
             WHEN er <= p67 THEN 'AVERAGE'
             ELSE 'HIGH'
           END AS computed_class
    FROM raw_eligible
  ), updated AS (
    UPDATE public.predictions prediction
    SET actual_er = eligible.er,
        actual_source = 'instagram_media_id',
        realized_class = eligible.computed_class,
        realized_class_basis = CASE WHEN eligible.computed_class IS NULL THEN NULL
          ELSE jsonb_build_object(
            'model_id', eligible.model_id::TEXT,
            'model_version', eligible.model_version,
            'p33_threshold', eligible.p33,
            'p67_threshold', eligible.p67,
            'computed_at', now(),
            'minimum_post_age_days', 7,
            'observation_policy', 'cumulative_at_latest_sync_after_maturity_gate',
            'maturity_policy', 'cumulative_at_latest_sync_after_7_day_gate'
          )
        END
    FROM eligible
    WHERE prediction.id = eligible.prediction_id
      AND (
        prediction.actual_er IS DISTINCT FROM eligible.er
        OR prediction.actual_source IS DISTINCT FROM 'instagram_media_id'
        OR prediction.realized_class IS DISTINCT FROM eligible.computed_class
        OR (
          eligible.computed_class IS NOT NULL
          AND (
            prediction.realized_class_basis->>'model_id' IS DISTINCT FROM eligible.model_id::TEXT
            OR prediction.realized_class_basis->>'p33_threshold' IS DISTINCT FROM eligible.p33::TEXT
            OR prediction.realized_class_basis->>'p67_threshold' IS DISTINCT FROM eligible.p67::TEXT
          )
        )
        OR (eligible.computed_class IS NULL AND prediction.realized_class_basis IS NOT NULL)
      )
    RETURNING prediction.id
  )
  SELECT count(*) INTO changed_count FROM updated;

  UPDATE public.prediction_publications publication
  SET last_reconciled_at = timezone('utc'::text, now()),
      outcome_observed_at = COALESCE(
        publication.outcome_observed_at,
        timezone('utc'::text, now())
      )
  FROM public.posts post, public.predictions prediction
  WHERE post.id = publication.post_id
    AND prediction.id = publication.prediction_id
    AND (p_brand_id IS NULL OR publication.brand_id = p_brand_id)
    AND prediction.actual_class IS NULL
    AND post.source = 'instagram_graph'
    AND post.instagram_media_id = publication.instagram_media_id
    AND post.er IS NOT NULL
    AND post.created_at IS NOT NULL
    AND post.created_at <= now() - (7 * interval '1 day');

  RETURN changed_count;
END
$$;

REVOKE ALL ON FUNCTION public.validate_prediction_observed_outcome()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_prediction_observed_outcome()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_prediction_publication_outcomes(UUID)
  FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
