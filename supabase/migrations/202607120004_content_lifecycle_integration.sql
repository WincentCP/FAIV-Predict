-- Bind each workspace to one immutable Instagram account and retain the
-- user-authored onboarding context used by planning/AI assistance. Tokens stay
-- in runtime secret configuration and are deliberately absent from this schema.
ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS instagram_account_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS profile_summary TEXT,
  ADD COLUMN IF NOT EXISTS timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Jakarta';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'brands_instagram_account_id_check'
      AND conrelid = 'public.brands'::regclass
  ) THEN
    ALTER TABLE public.brands
      ADD CONSTRAINT brands_instagram_account_id_check
      CHECK (
        instagram_account_id IS NULL
        OR instagram_account_id ~ '^[0-9]{5,64}$'
      ) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'brands_profile_summary_length_check'
      AND conrelid = 'public.brands'::regclass
  ) THEN
    ALTER TABLE public.brands
      ADD CONSTRAINT brands_profile_summary_length_check
      CHECK (profile_summary IS NULL OR char_length(profile_summary) <= 4000)
      NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'brands_timezone_wib_check'
      AND conrelid = 'public.brands'::regclass
  ) THEN
    ALTER TABLE public.brands
      ADD CONSTRAINT brands_timezone_wib_check
      CHECK (timezone = 'Asia/Jakarta') NOT VALID;
  END IF;
END $$;
ALTER TABLE public.brands VALIDATE CONSTRAINT brands_timezone_wib_check;

CREATE UNIQUE INDEX IF NOT EXISTS idx_brands_instagram_account_unique
  ON public.brands(instagram_account_id)
  WHERE instagram_account_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.prevent_brand_instagram_identity_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.instagram_account_id IS NOT NULL
    AND NEW.instagram_account_id IS DISTINCT FROM OLD.instagram_account_id THEN
    RAISE EXCEPTION 'A brand Instagram account binding is immutable once verified.'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS brands_prevent_instagram_identity_change ON public.brands;
CREATE TRIGGER brands_prevent_instagram_identity_change
BEFORE UPDATE OF instagram_account_id ON public.brands
FOR EACH ROW
EXECUTE FUNCTION public.prevent_brand_instagram_identity_change();

-- One prediction can represent at most one real publication, and one verified
-- post can evaluate at most one prediction. Re-linking is intentionally not an
-- update operation: an incorrect link requires an explicit administrator audit.
CREATE TABLE IF NOT EXISTS public.prediction_publications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  brand_id UUID REFERENCES public.brands(id) ON DELETE CASCADE NOT NULL,
  prediction_id UUID REFERENCES public.predictions(id) ON DELETE RESTRICT NOT NULL,
  post_id UUID REFERENCES public.posts(id) ON DELETE RESTRICT NOT NULL,
  instagram_media_id VARCHAR(255) NOT NULL,
  linked_by UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  link_method VARCHAR(40) DEFAULT 'verified_media_confirmation' NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  last_reconciled_at TIMESTAMP WITH TIME ZONE,
  outcome_observed_at TIMESTAMP WITH TIME ZONE,
  CONSTRAINT prediction_publications_prediction_unique UNIQUE (prediction_id),
  CONSTRAINT prediction_publications_post_unique UNIQUE (post_id),
  CONSTRAINT prediction_publications_brand_media_unique UNIQUE (brand_id, instagram_media_id),
  CONSTRAINT prediction_publications_link_method_check
    CHECK (link_method = 'verified_media_confirmation')
);

CREATE INDEX IF NOT EXISTS idx_prediction_publications_owner_time
  ON public.prediction_publications(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prediction_publications_brand_time
  ON public.prediction_publications(brand_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.validate_prediction_publication()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  prediction_brand UUID;
  prediction_owner UUID;
  post_brand UUID;
  post_media_id TEXT;
  post_source TEXT;
  brand_owner UUID;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.owner_id IS DISTINCT FROM OLD.owner_id
      OR NEW.brand_id IS DISTINCT FROM OLD.brand_id
      OR NEW.prediction_id IS DISTINCT FROM OLD.prediction_id
      OR NEW.post_id IS DISTINCT FROM OLD.post_id
      OR NEW.instagram_media_id IS DISTINCT FROM OLD.instagram_media_id
      OR NEW.linked_by IS DISTINCT FROM OLD.linked_by
      OR NEW.link_method IS DISTINCT FROM OLD.link_method
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Prediction publication identity is immutable.'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  SELECT prediction.brand_id, prediction.created_by
  INTO prediction_brand, prediction_owner
  FROM public.predictions prediction
  WHERE prediction.id = NEW.prediction_id
    AND prediction.deleted_at IS NULL;
  IF NOT FOUND OR prediction_owner IS NULL THEN
    RAISE EXCEPTION 'Prediction must be active and owned.'
      USING ERRCODE = '23514';
  END IF;

  SELECT post.brand_id, post.instagram_media_id, post.source
  INTO post_brand, post_media_id, post_source
  FROM public.posts post
  WHERE post.id = NEW.post_id;
  IF NOT FOUND
    OR post_source IS DISTINCT FROM 'instagram_graph'
    OR post_media_id IS NULL THEN
    RAISE EXCEPTION 'Publication post must be verified Instagram Graph media.'
      USING ERRCODE = '23514';
  END IF;

  SELECT brand.owner_id INTO brand_owner
  FROM public.brands brand
  WHERE brand.id = prediction_brand;
  IF prediction_brand IS DISTINCT FROM post_brand
    OR prediction_owner IS DISTINCT FROM brand_owner
    OR NEW.linked_by IS DISTINCT FROM prediction_owner THEN
    RAISE EXCEPTION 'Prediction and publication must belong to the same user and brand.'
      USING ERRCODE = '23514';
  END IF;

  NEW.owner_id := prediction_owner;
  NEW.brand_id := prediction_brand;
  NEW.instagram_media_id := post_media_id;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS prediction_publications_validate ON public.prediction_publications;
CREATE TRIGGER prediction_publications_validate
BEFORE INSERT OR UPDATE ON public.prediction_publications
FOR EACH ROW
EXECUTE FUNCTION public.validate_prediction_publication();

CREATE OR REPLACE FUNCTION public.link_prediction_publication(
  p_prediction_id UUID,
  p_post_id UUID
)
RETURNS TABLE (
  publication_id UUID,
  prediction_id UUID,
  post_id UUID,
  instagram_media_id VARCHAR,
  created_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  request_user UUID := auth.uid();
  existing public.prediction_publications%ROWTYPE;
  target_brand UUID;
  target_media_id VARCHAR(255);
BEGIN
  IF request_user IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.' USING ERRCODE = '42501';
  END IF;

  SELECT publication.* INTO existing
  FROM public.prediction_publications publication
  WHERE publication.prediction_id = p_prediction_id;
  IF FOUND THEN
    IF existing.owner_id IS DISTINCT FROM request_user
      OR existing.post_id IS DISTINCT FROM p_post_id THEN
      RAISE EXCEPTION 'Prediction is already linked to another publication.'
        USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT existing.id, existing.prediction_id, existing.post_id,
      existing.instagram_media_id, existing.created_at;
    RETURN;
  END IF;

  SELECT prediction.brand_id INTO target_brand
  FROM public.predictions prediction
  JOIN public.brands brand ON brand.id = prediction.brand_id
  WHERE prediction.id = p_prediction_id
    AND prediction.created_by = request_user
    AND prediction.deleted_at IS NULL
    AND brand.owner_id = request_user;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Prediction and publication must belong to the current user.'
      USING ERRCODE = '23514';
  END IF;

  SELECT post.instagram_media_id INTO target_media_id
  FROM public.posts post
  WHERE post.id = p_post_id
    AND post.brand_id = target_brand
    AND post.source = 'instagram_graph'
    AND post.instagram_media_id IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Publication post must be verified Instagram Graph media for this brand.'
      USING ERRCODE = '23514';
  END IF;

  BEGIN
    INSERT INTO public.prediction_publications (
      owner_id, brand_id, prediction_id, post_id, instagram_media_id, linked_by
    ) VALUES (
      request_user, target_brand, p_prediction_id, p_post_id, target_media_id, request_user
    )
    RETURNING prediction_publications.id,
              prediction_publications.prediction_id,
              prediction_publications.post_id,
              prediction_publications.instagram_media_id,
              prediction_publications.created_at
    INTO publication_id, prediction_id, post_id, instagram_media_id, created_at;
  EXCEPTION WHEN unique_violation THEN
    -- Treat a concurrent duplicate confirmation as an idempotent replay, but
    -- never hide a conflicting post/prediction mapping.
    SELECT publication.* INTO existing
    FROM public.prediction_publications publication
    WHERE publication.prediction_id = p_prediction_id;
    IF FOUND
      AND existing.owner_id IS NOT DISTINCT FROM request_user
      AND existing.post_id IS NOT DISTINCT FROM p_post_id THEN
      publication_id := existing.id;
      prediction_id := existing.prediction_id;
      post_id := existing.post_id;
      instagram_media_id := existing.instagram_media_id;
      created_at := existing.created_at;
    ELSE
      RAISE EXCEPTION 'Prediction or verified Instagram post is already linked elsewhere.'
        USING ERRCODE = '23505';
    END IF;
  END;
  RETURN NEXT;
END
$$;

CREATE OR REPLACE FUNCTION public.audit_prediction_publication_link()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.content_lifecycle_events (
    owner_id, brand_id, prediction_id, event_type, source, actor_id, metadata
  ) VALUES (
    NEW.owner_id,
    NEW.brand_id,
    NEW.prediction_id,
    'publication.linked',
    'database_trigger',
    NEW.linked_by,
    jsonb_build_object(
      'publication_id', NEW.id,
      'post_id', NEW.post_id,
      'instagram_media_id', NEW.instagram_media_id,
      'link_method', NEW.link_method
    )
  );
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS prediction_publications_audit_link ON public.prediction_publications;
CREATE TRIGGER prediction_publications_audit_link
AFTER INSERT ON public.prediction_publications
FOR EACH ROW
EXECUTE FUNCTION public.audit_prediction_publication_link();

-- A verified lifetime ER is observable only after the same seven-day maturity
-- horizon used by training. Three-tier actual_class is intentionally not
-- derived because a valid class requires a fixed, predeclared reference set.
-- Legacy rows are preserved for audit. Trigger guards below protect new
-- outcome writes without making unrelated edits to a legacy row fail.

CREATE OR REPLACE FUNCTION public.validate_prediction_observed_outcome()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  verified_er NUMERIC;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.actual_er IS NOT NULL
      OR NEW.actual_source IS NOT NULL
      OR NEW.actual_class IS NOT NULL THEN
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
    AND NEW.actual_source IS NOT DISTINCT FROM OLD.actual_source THEN
    RETURN NEW;
  END IF;
  IF NEW.actual_source IS DISTINCT FROM 'instagram_media_id' THEN
    RAISE EXCEPTION 'Observed outcomes cannot be written or cleared outside a verified publication reconciliation.'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.actual_class IS NOT NULL THEN
    RAISE EXCEPTION 'Verified outcomes store continuous ER only; actual_class is not derived.'
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
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS predictions_validate_observed_outcome ON public.predictions;
CREATE TRIGGER predictions_validate_observed_outcome
BEFORE UPDATE OF actual_er, actual_source, actual_class ON public.predictions
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
    AND OLD.actual_source IS NOT DISTINCT FROM NEW.actual_source THEN
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
      'actual_class_derived', false
    ))
  );
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS predictions_audit_observed_outcome ON public.predictions;
CREATE TRIGGER predictions_audit_observed_outcome
AFTER UPDATE OF actual_er, actual_source ON public.predictions
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
  WITH eligible AS (
    SELECT publication.id AS publication_id,
           publication.prediction_id,
           post.er
    FROM public.prediction_publications publication
    JOIN public.posts post ON post.id = publication.post_id
    JOIN public.predictions prediction ON prediction.id = publication.prediction_id
    WHERE (p_brand_id IS NULL OR publication.brand_id = p_brand_id)
      AND prediction.actual_class IS NULL
      AND post.brand_id = publication.brand_id
      AND post.source = 'instagram_graph'
      AND post.instagram_media_id = publication.instagram_media_id
      AND post.er IS NOT NULL
      AND post.created_at IS NOT NULL
      AND post.created_at <= now() - (7 * interval '1 day')
  ), updated AS (
    UPDATE public.predictions prediction
    SET actual_er = eligible.er,
        actual_source = 'instagram_media_id'
    FROM eligible
    WHERE prediction.id = eligible.prediction_id
      AND (
        prediction.actual_er IS DISTINCT FROM eligible.er
        OR prediction.actual_source IS DISTINCT FROM 'instagram_media_id'
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

CREATE OR REPLACE FUNCTION public.reconcile_new_prediction_publication()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.reconcile_prediction_publication_outcomes(NEW.brand_id);
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS prediction_publications_reconcile_outcome
  ON public.prediction_publications;
CREATE TRIGGER prediction_publications_reconcile_outcome
AFTER INSERT ON public.prediction_publications
FOR EACH ROW
EXECUTE FUNCTION public.reconcile_new_prediction_publication();

ALTER TABLE public.prediction_publications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS publication_owner_select ON public.prediction_publications;
CREATE POLICY publication_owner_select ON public.prediction_publications
FOR SELECT TO authenticated
USING (owner_id = auth.uid());
REVOKE ALL ON public.prediction_publications FROM anon, authenticated;
GRANT SELECT ON public.prediction_publications TO authenticated;
REVOKE ALL ON FUNCTION public.link_prediction_publication(UUID, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_prediction_publication(UUID, UUID)
  TO authenticated;

-- Application users may maintain planning context, but only the trusted sync
-- service/database owner may bind instagram_account_id.
REVOKE INSERT, UPDATE ON public.brands FROM authenticated;
GRANT INSERT (owner_id, name, niche, profile_summary, timezone)
  ON public.brands TO authenticated;
GRANT UPDATE (name, niche, profile_summary, timezone)
  ON public.brands TO authenticated;

-- Migration 002 originally used COALESCE(OLD.prediction_id, NEW.prediction_id)
-- when a plan edit changed model inputs. If an unscored plan was edited and
-- linked to its first freshly-created prediction in the same PATCH, that could
-- incorrectly mark the new result stale. Only a prediction that was already
-- linked before the edit can represent the old plan snapshot.
CREATE OR REPLACE FUNCTION public.mark_calendar_prediction_stale()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  previous_prediction UUID := OLD.prediction_id;
  audit_prediction UUID := COALESCE(OLD.prediction_id, NEW.prediction_id);
  any_change BOOLEAN;
  model_inputs_changed BOOLEAN;
BEGIN
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

  IF previous_prediction IS NOT NULL AND model_inputs_changed THEN
    UPDATE public.predictions
    SET prediction_status = 'stale',
        stale_reason = 'Linked Content Plan model inputs changed after prediction',
        stale_at = timezone('utc'::text, now())
    WHERE id = previous_prediction
      AND created_by = NEW.owner_id
      AND prediction_status <> 'superseded';
  END IF;

  INSERT INTO public.content_lifecycle_events (
    owner_id, brand_id, prediction_id, calendar_entry_id,
    event_type, actor_id, metadata
  ) VALUES (
    NEW.owner_id,
    NEW.brand_id,
    audit_prediction,
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
      'old_prediction_id', OLD.prediction_id,
      'new_prediction_id', NEW.prediction_id,
      'old_date', OLD.posting_date,
      'new_date', NEW.posting_date,
      'old_time', OLD.posting_time,
      'new_time', NEW.posting_time
    )
  );
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.prevent_brand_instagram_identity_change()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_prediction_publication()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_prediction_publication_link()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_prediction_observed_outcome()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_prediction_observed_outcome()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_prediction_publication_outcomes(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_new_prediction_publication()
  FROM PUBLIC, anon, authenticated;
