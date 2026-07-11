-- Durable prediction validity, supersession, and audit history.
-- This migration is additive and preserves every existing prediction.

ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS prediction_status VARCHAR(20) NOT NULL DEFAULT 'current',
  ADD COLUMN IF NOT EXISTS time_known BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS stale_reason TEXT,
  ADD COLUMN IF NOT EXISTS stale_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS supersedes_prediction_id UUID,
  ADD COLUMN IF NOT EXISTS supersession_reason VARCHAR(30),
  ADD COLUMN IF NOT EXISTS model_id UUID REFERENCES public.models(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS feature_schema_version VARCHAR(80),
  ADD COLUMN IF NOT EXISTS input_hash CHAR(64),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.predictions
  DROP CONSTRAINT IF EXISTS predictions_supersedes_prediction_id_fkey;
ALTER TABLE public.predictions
  ADD CONSTRAINT predictions_supersedes_prediction_id_fkey
  FOREIGN KEY (supersedes_prediction_id) REFERENCES public.predictions(id) ON DELETE RESTRICT;

ALTER TABLE public.calendar_entries
  DROP CONSTRAINT IF EXISTS calendar_entries_prediction_id_fkey;
ALTER TABLE public.calendar_entries
  ADD CONSTRAINT calendar_entries_prediction_id_fkey
  FOREIGN KEY (prediction_id) REFERENCES public.predictions(id) ON DELETE RESTRICT;

UPDATE public.predictions
SET time_known = false,
    prediction_status = CASE
      WHEN prediction_status = 'current' THEN 'provisional'
      ELSE prediction_status
    END
WHERE features->'post_hour' IS NULL
   OR features->'post_hour' = 'null'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'predictions_status_check'
      AND conrelid = 'public.predictions'::regclass
  ) THEN
    ALTER TABLE public.predictions
      ADD CONSTRAINT predictions_status_check
      CHECK (prediction_status IN ('current', 'provisional', 'stale', 'superseded'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'predictions_supersession_check'
      AND conrelid = 'public.predictions'::regclass
  ) THEN
    ALTER TABLE public.predictions
      ADD CONSTRAINT predictions_supersession_check CHECK (
        supersedes_prediction_id IS DISTINCT FROM id
        AND (
          (supersedes_prediction_id IS NULL AND supersession_reason IS NULL)
          OR
          (supersedes_prediction_id IS NOT NULL AND supersession_reason IN (
            'inputs_changed', 'time_finalized', 'manual_rerun'
          ))
        )
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'predictions_time_status_check'
      AND conrelid = 'public.predictions'::regclass
  ) THEN
    ALTER TABLE public.predictions
      ADD CONSTRAINT predictions_time_status_check CHECK (
        (prediction_status <> 'current' OR time_known)
        AND (prediction_status <> 'provisional' OR NOT time_known)
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_predictions_status
  ON public.predictions(created_by, prediction_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_predictions_supersedes
  ON public.predictions(supersedes_prediction_id)
  WHERE supersedes_prediction_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_predictions_one_successor
  ON public.predictions(supersedes_prediction_id)
  WHERE supersedes_prediction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_predictions_visible_history
  ON public.predictions(created_by, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_predictions_model_id
  ON public.predictions(model_id)
  WHERE model_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_predictions_input_hash
  ON public.predictions(created_by, input_hash)
  WHERE input_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.content_lifecycle_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_id UUID REFERENCES public.brands(id) ON DELETE SET NULL,
  prediction_id UUID REFERENCES public.predictions(id) ON DELETE RESTRICT,
  calendar_entry_id UUID REFERENCES public.calendar_entries(id) ON DELETE SET NULL,
  event_type VARCHAR(80) NOT NULL,
  source VARCHAR(30) NOT NULL DEFAULT 'database_trigger',
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.content_lifecycle_events
  DROP CONSTRAINT IF EXISTS content_lifecycle_events_prediction_id_fkey;
ALTER TABLE public.content_lifecycle_events
  ADD CONSTRAINT content_lifecycle_events_prediction_id_fkey
  FOREIGN KEY (prediction_id) REFERENCES public.predictions(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_lifecycle_events_owner_time
  ON public.content_lifecycle_events(owner_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_lifecycle_events_prediction
  ON public.content_lifecycle_events(prediction_id, occurred_at DESC)
  WHERE prediction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lifecycle_events_calendar
  ON public.content_lifecycle_events(calendar_entry_id, occurred_at DESC)
  WHERE calendar_entry_id IS NOT NULL;

ALTER TABLE public.content_lifecycle_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lifecycle_owner_select ON public.content_lifecycle_events;
CREATE POLICY lifecycle_owner_select
  ON public.content_lifecycle_events
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

REVOKE ALL ON public.content_lifecycle_events FROM anon, authenticated;
GRANT SELECT ON public.content_lifecycle_events TO authenticated;

-- Prediction snapshots are evidence, not editable drafts. Users may rename or
-- soft-delete their own rows, but cannot rewrite scored inputs or hard-delete
-- lineage through PostgREST.
REVOKE UPDATE, DELETE ON public.predictions FROM authenticated;
GRANT UPDATE (title, deleted_at) ON public.predictions TO authenticated;
DROP POLICY IF EXISTS owner_delete ON public.predictions;

CREATE OR REPLACE FUNCTION public.normalize_prediction_soft_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    NEW.deleted_at := timezone('utc'::text, now());
    NEW.deleted_by := auth.uid();
  ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    NEW.deleted_by := NULL;
  ELSE
    NEW.deleted_by := OLD.deleted_by;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS predictions_normalize_soft_delete ON public.predictions;
CREATE TRIGGER predictions_normalize_soft_delete
BEFORE UPDATE OF deleted_at, deleted_by ON public.predictions
FOR EACH ROW
EXECUTE FUNCTION public.normalize_prediction_soft_delete();

CREATE OR REPLACE FUNCTION public.validate_prediction_supersession()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.supersedes_prediction_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.predictions parent
    WHERE parent.id = NEW.supersedes_prediction_id
      AND parent.brand_id = NEW.brand_id
      AND parent.created_by = NEW.created_by
      AND parent.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Superseded prediction must belong to the same user and brand.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS predictions_validate_supersession ON public.predictions;
CREATE TRIGGER predictions_validate_supersession
BEFORE INSERT ON public.predictions
FOR EACH ROW
EXECUTE FUNCTION public.validate_prediction_supersession();

CREATE OR REPLACE FUNCTION public.prevent_prediction_snapshot_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.brand_id IS DISTINCT FROM NEW.brand_id
    OR OLD.created_by IS DISTINCT FROM NEW.created_by
    OR OLD.caption IS DISTINCT FROM NEW.caption
    OR OLD.features IS DISTINCT FROM NEW.features
    OR OLD.pred_class IS DISTINCT FROM NEW.pred_class
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR OLD.scheduled_date IS DISTINCT FROM NEW.scheduled_date
    OR OLD.model_version IS DISTINCT FROM NEW.model_version
    OR OLD.model_id IS DISTINCT FROM NEW.model_id
    OR OLD.feature_schema_version IS DISTINCT FROM NEW.feature_schema_version
    OR OLD.input_hash IS DISTINCT FROM NEW.input_hash
    OR OLD.time_known IS DISTINCT FROM NEW.time_known
    OR OLD.supersedes_prediction_id IS DISTINCT FROM NEW.supersedes_prediction_id
    OR OLD.supersession_reason IS DISTINCT FROM NEW.supersession_reason THEN
    RAISE EXCEPTION 'Prediction input/output snapshots are immutable; create a successor prediction instead.'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS predictions_mark_input_change_stale ON public.predictions;
DROP FUNCTION IF EXISTS public.mark_prediction_input_change_stale();
DROP TRIGGER IF EXISTS predictions_prevent_snapshot_mutation ON public.predictions;
CREATE TRIGGER predictions_prevent_snapshot_mutation
BEFORE UPDATE ON public.predictions
FOR EACH ROW
EXECUTE FUNCTION public.prevent_prediction_snapshot_mutation();

CREATE OR REPLACE FUNCTION public.audit_prediction_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  event_name TEXT;
  event_metadata JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    event_name := 'prediction.created';
    event_metadata := jsonb_strip_nulls(jsonb_build_object(
      'status', NEW.prediction_status,
      'stale_reason', NEW.stale_reason,
      'time_known', NEW.time_known,
      'model_version', NEW.model_version,
      'model_id', NEW.model_id,
      'feature_schema_version', NEW.feature_schema_version,
      'input_hash', NEW.input_hash,
      'supersedes_prediction_id', NEW.supersedes_prediction_id,
      'supersession_reason', NEW.supersession_reason,
      'requested_by', NEW.created_by
    ));
  ELSIF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    event_name := 'prediction.deleted';
    event_metadata := jsonb_strip_nulls(jsonb_build_object(
      'status', NEW.prediction_status,
      'deleted_at', NEW.deleted_at,
      'deleted_by', NEW.deleted_by
    ));
  ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    event_name := 'prediction.restored';
    event_metadata := jsonb_strip_nulls(jsonb_build_object(
      'status', NEW.prediction_status,
      'restored_by', auth.uid()
    ));
  ELSIF OLD.prediction_status IS DISTINCT FROM NEW.prediction_status THEN
    event_name := 'prediction.' || NEW.prediction_status;
    event_metadata := jsonb_strip_nulls(jsonb_build_object(
      'previous_status', OLD.prediction_status,
      'status', NEW.prediction_status,
      'stale_reason', NEW.stale_reason,
      'time_known', NEW.time_known,
      'model_version', NEW.model_version,
      'model_id', NEW.model_id,
      'feature_schema_version', NEW.feature_schema_version,
      'input_hash', NEW.input_hash,
      'supersedes_prediction_id', NEW.supersedes_prediction_id,
      'supersession_reason', NEW.supersession_reason
    ));
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.content_lifecycle_events (
    owner_id, brand_id, prediction_id, event_type, actor_id, metadata
  ) VALUES (
    NEW.created_by,
    NEW.brand_id,
    NEW.id,
    event_name,
    auth.uid(),
    event_metadata
  );
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS predictions_audit_lifecycle ON public.predictions;
CREATE TRIGGER predictions_audit_lifecycle
AFTER INSERT OR UPDATE ON public.predictions
FOR EACH ROW
EXECUTE FUNCTION public.audit_prediction_lifecycle();

CREATE OR REPLACE FUNCTION public.mark_calendar_prediction_stale()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  linked_prediction UUID;
  any_change BOOLEAN;
  model_inputs_changed BOOLEAN;
BEGIN
  linked_prediction := COALESCE(OLD.prediction_id, NEW.prediction_id);
  any_change := (
    OLD.posting_date IS DISTINCT FROM NEW.posting_date
    OR OLD.posting_time IS DISTINCT FROM NEW.posting_time
    OR OLD.content_type IS DISTINCT FROM NEW.content_type
    OR OLD.caption IS DISTINCT FROM NEW.caption
    OR OLD.brand_id IS DISTINCT FROM NEW.brand_id
  );
  IF NOT any_change THEN
    RETURN NEW;
  END IF;

  model_inputs_changed := (
    OLD.content_type IS DISTINCT FROM NEW.content_type
    OR OLD.caption IS DISTINCT FROM NEW.caption
    OR OLD.brand_id IS DISTINCT FROM NEW.brand_id
    OR EXTRACT(HOUR FROM OLD.posting_time) IS DISTINCT FROM EXTRACT(HOUR FROM NEW.posting_time)
    OR (EXTRACT(ISODOW FROM OLD.posting_date) IN (6, 7)) IS DISTINCT FROM
       (EXTRACT(ISODOW FROM NEW.posting_date) IN (6, 7))
  );

  IF linked_prediction IS NOT NULL AND model_inputs_changed THEN
    UPDATE public.predictions
    SET prediction_status = 'stale',
        stale_reason = 'Linked calendar model inputs changed after prediction',
        stale_at = timezone('utc'::text, now())
    WHERE id = linked_prediction
      AND created_by = NEW.owner_id
      AND prediction_status <> 'superseded';
  END IF;

  INSERT INTO public.content_lifecycle_events (
    owner_id, brand_id, prediction_id, calendar_entry_id,
    event_type, actor_id, metadata
  ) VALUES (
    NEW.owner_id,
    NEW.brand_id,
    linked_prediction,
    NEW.id,
    CASE WHEN model_inputs_changed
      THEN 'calendar.model_inputs_changed'
      ELSE 'calendar.schedule_changed'
    END,
    auth.uid(),
    jsonb_build_object(
      'date_changed', OLD.posting_date IS DISTINCT FROM NEW.posting_date,
      'time_changed', OLD.posting_time IS DISTINCT FROM NEW.posting_time,
      'format_changed', OLD.content_type IS DISTINCT FROM NEW.content_type,
      'caption_changed', OLD.caption IS DISTINCT FROM NEW.caption,
      'brand_changed', OLD.brand_id IS DISTINCT FROM NEW.brand_id,
      'model_inputs_changed', model_inputs_changed,
      'old_date', OLD.posting_date,
      'new_date', NEW.posting_date,
      'old_time', OLD.posting_time,
      'new_time', NEW.posting_time
    )
  );
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS calendar_mark_prediction_stale ON public.calendar_entries;
CREATE TRIGGER calendar_mark_prediction_stale
AFTER UPDATE OF posting_date, posting_time, content_type, caption, brand_id
ON public.calendar_entries
FOR EACH ROW
EXECUTE FUNCTION public.mark_calendar_prediction_stale();

CREATE OR REPLACE FUNCTION public.validate_calendar_prediction_link()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.prediction_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.predictions prediction
    WHERE prediction.id = NEW.prediction_id
      AND prediction.created_by = NEW.owner_id
      AND prediction.brand_id IS NOT DISTINCT FROM NEW.brand_id
      AND prediction.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Linked prediction must be active and belong to the same user and brand.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS calendar_validate_prediction_link_insert ON public.calendar_entries;
CREATE TRIGGER calendar_validate_prediction_link_insert
BEFORE INSERT ON public.calendar_entries
FOR EACH ROW EXECUTE FUNCTION public.validate_calendar_prediction_link();
DROP TRIGGER IF EXISTS calendar_validate_prediction_link_update ON public.calendar_entries;
CREATE TRIGGER calendar_validate_prediction_link_update
BEFORE UPDATE OF prediction_id, owner_id, brand_id ON public.calendar_entries
FOR EACH ROW EXECUTE FUNCTION public.validate_calendar_prediction_link();

CREATE OR REPLACE FUNCTION public.audit_calendar_prediction_link()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  previous_prediction UUID;
  event_name TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    previous_prediction := OLD.prediction_id;
  ELSE
    previous_prediction := NULL;
  END IF;
  IF previous_prediction IS NOT DISTINCT FROM NEW.prediction_id THEN
    RETURN NEW;
  END IF;
  event_name := CASE
    WHEN previous_prediction IS NULL THEN 'calendar.prediction_linked'
    WHEN NEW.prediction_id IS NULL THEN 'calendar.prediction_unlinked'
    ELSE 'calendar.prediction_relinked'
  END;
  INSERT INTO public.content_lifecycle_events (
    owner_id, brand_id, prediction_id, calendar_entry_id,
    event_type, actor_id, metadata
  ) VALUES (
    NEW.owner_id,
    NEW.brand_id,
    COALESCE(NEW.prediction_id, previous_prediction),
    NEW.id,
    event_name,
    auth.uid(),
    jsonb_strip_nulls(jsonb_build_object(
      'previous_prediction_id', previous_prediction,
      'prediction_id', NEW.prediction_id
    ))
  );
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS calendar_audit_prediction_link_insert ON public.calendar_entries;
CREATE TRIGGER calendar_audit_prediction_link_insert
AFTER INSERT ON public.calendar_entries
FOR EACH ROW EXECUTE FUNCTION public.audit_calendar_prediction_link();
DROP TRIGGER IF EXISTS calendar_audit_prediction_link_update ON public.calendar_entries;
CREATE TRIGGER calendar_audit_prediction_link_update
AFTER UPDATE OF prediction_id ON public.calendar_entries
FOR EACH ROW EXECUTE FUNCTION public.audit_calendar_prediction_link();

REVOKE ALL ON FUNCTION public.prevent_prediction_snapshot_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_prediction_supersession() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.normalize_prediction_soft_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_prediction_lifecycle() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_calendar_prediction_stale() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_calendar_prediction_link() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_calendar_prediction_link() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
