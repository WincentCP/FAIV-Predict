-- DDL SQL Supabase PostgreSQL untuk sistem FAIV Predict

-- Enable UUID extension if not enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Tabel brands
CREATE TABLE IF NOT EXISTS brands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    niche VARCHAR(255) NOT NULL,
    followers INTEGER,
    model_type VARCHAR(50) DEFAULT 'niche' NOT NULL, -- 'niche' atau 'personal'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Safe upgrade path for databases created before per-user ownership existed.
ALTER TABLE brands ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE brands ALTER COLUMN followers DROP DEFAULT;

-- Never infer ownership from the number of users in Auth. Legacy rows stay
-- unowned and invisible until an administrator explicitly maps verified brand
-- IDs to a user. This prevents old demo or third-party rows from being exposed.

-- 2. Tabel posts
CREATE TABLE IF NOT EXISTS posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID REFERENCES brands(id) ON DELETE CASCADE NOT NULL,
    caption TEXT,
    er NUMERIC NOT NULL,
    is_synced BOOLEAN DEFAULT false NOT NULL,
    follower_count_at_post INTEGER NOT NULL,
    is_single_image BOOLEAN DEFAULT false NOT NULL,
    is_carousel BOOLEAN DEFAULT false NOT NULL,
    is_reels BOOLEAN DEFAULT false NOT NULL,
    post_hour INTEGER NOT NULL,
    caption_length INTEGER NOT NULL,
    hashtag_count INTEGER NOT NULL,
    has_cta BOOLEAN DEFAULT false NOT NULL,
    instagram_media_id VARCHAR(255),
    media_product_type VARCHAR(50),
    source VARCHAR(50),
    synced_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE posts ADD COLUMN IF NOT EXISTS instagram_media_id VARCHAR(255);
ALTER TABLE posts ADD COLUMN IF NOT EXISTS media_product_type VARCHAR(50);
ALTER TABLE posts ADD COLUMN IF NOT EXISTS source VARCHAR(50);
ALTER TABLE posts ADD COLUMN IF NOT EXISTS synced_at TIMESTAMP WITH TIME ZONE;

-- A legacy zero with no synced posts represented "not connected", not a
-- verified follower count. Preserve real synced zeroes and all non-zero data.
UPDATE brands b
SET followers = NULL
WHERE followers = 0
  AND NOT EXISTS (SELECT 1 FROM posts p WHERE p.brand_id = b.id AND p.is_synced);

-- 3. Tabel predictions
CREATE TABLE IF NOT EXISTS predictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID REFERENCES brands(id) ON DELETE CASCADE NOT NULL,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    caption TEXT,
    features JSONB NOT NULL, -- Menyimpan parameter input prediction
    pred_class VARCHAR(50) NOT NULL, -- 'HIGH', 'AVERAGE', 'LOW'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    scheduled_date DATE,
    actual_er NUMERIC,               -- Real ER once the predicted post is synced back
    actual_class VARCHAR(50),        -- Realized tier, graded with the same percentile method
    actual_source VARCHAR(50),       -- NULL quarantines legacy caption-matched outcomes
    model_version VARCHAR(50),       -- Version of the model that produced this prediction
    prediction_status VARCHAR(20) DEFAULT 'current' NOT NULL,
    time_known BOOLEAN DEFAULT true NOT NULL,
    stale_reason TEXT,
    stale_at TIMESTAMP WITH TIME ZONE,
    supersedes_prediction_id UUID REFERENCES predictions(id) ON DELETE RESTRICT,
    supersession_reason VARCHAR(30),
    model_id UUID,
    feature_schema_version VARCHAR(80),
    input_hash CHAR(64),
    deleted_at TIMESTAMP WITH TIME ZONE,
    deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT predictions_status_check CHECK (prediction_status IN ('current', 'provisional', 'stale', 'superseded')),
    CONSTRAINT predictions_supersession_check CHECK (
      supersedes_prediction_id IS DISTINCT FROM id AND (
        (supersedes_prediction_id IS NULL AND supersession_reason IS NULL)
        OR (supersedes_prediction_id IS NOT NULL AND supersession_reason IN ('inputs_changed', 'time_finalized', 'manual_rerun'))
      )
    ),
    CONSTRAINT predictions_time_status_check CHECK (
      (prediction_status <> 'current' OR time_known)
      AND (prediction_status <> 'provisional' OR NOT time_known)
    )
);

ALTER TABLE predictions ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS actual_source VARCHAR(50);
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS prediction_status VARCHAR(20) DEFAULT 'current' NOT NULL;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS time_known BOOLEAN DEFAULT true NOT NULL;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS stale_reason TEXT;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS stale_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS supersedes_prediction_id UUID;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS supersession_reason VARCHAR(30);
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS model_id UUID;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS feature_schema_version VARCHAR(80);
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS input_hash CHAR(64);
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE predictions DROP CONSTRAINT IF EXISTS predictions_supersedes_prediction_id_fkey;
ALTER TABLE predictions ADD CONSTRAINT predictions_supersedes_prediction_id_fkey
  FOREIGN KEY (supersedes_prediction_id) REFERENCES predictions(id) ON DELETE RESTRICT;

UPDATE predictions
SET time_known = false,
    prediction_status = CASE WHEN prediction_status = 'current' THEN 'provisional' ELSE prediction_status END
WHERE features->'post_hour' IS NULL OR features->'post_hour' = 'null'::jsonb;

-- Preserve legacy rows for administrator audit, but require ownership on all
-- new or updated records. NOT VALID intentionally avoids claiming old rows.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'brands_owner_required' AND conrelid = 'public.brands'::regclass
  ) THEN
    ALTER TABLE public.brands
      ADD CONSTRAINT brands_owner_required CHECK (owner_id IS NOT NULL) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'predictions_creator_required' AND conrelid = 'public.predictions'::regclass
  ) THEN
    ALTER TABLE public.predictions
      ADD CONSTRAINT predictions_creator_required CHECK (created_by IS NOT NULL) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'predictions_status_check' AND conrelid = 'public.predictions'::regclass
  ) THEN
    ALTER TABLE public.predictions ADD CONSTRAINT predictions_status_check
      CHECK (prediction_status IN ('current', 'provisional', 'stale', 'superseded'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'predictions_supersession_check' AND conrelid = 'public.predictions'::regclass
  ) THEN
    ALTER TABLE public.predictions ADD CONSTRAINT predictions_supersession_check CHECK (
      supersedes_prediction_id IS DISTINCT FROM id AND (
        (supersedes_prediction_id IS NULL AND supersession_reason IS NULL)
        OR (supersedes_prediction_id IS NOT NULL AND supersession_reason IN ('inputs_changed', 'time_finalized', 'manual_rerun'))
      )
    );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'predictions_time_status_check' AND conrelid = 'public.predictions'::regclass
  ) THEN
    ALTER TABLE public.predictions ADD CONSTRAINT predictions_time_status_check CHECK (
      (prediction_status <> 'current' OR time_known)
      AND (prediction_status <> 'provisional' OR NOT time_known)
    );
  END IF;
END $$;

-- 4. Tabel models
CREATE TABLE IF NOT EXISTS models (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID REFERENCES brands(id) ON DELETE CASCADE, -- NULL jika model shared-niche
    niche VARCHAR(255),                                    -- NULL jika model personal brand
    model_type VARCHAR(50) NOT NULL,                       -- 'niche' atau 'account'
    storage_path VARCHAR(500) NOT NULL,                    -- Path lokal/Supabase Storage bucket
    storage_url VARCHAR(500),                              -- URL publik untuk unduhan
    version VARCHAR(50) NOT NULL,
    accuracy NUMERIC,                                      -- Akurasi evaluasi model
    metrics JSONB NOT NULL,                                -- Evaluasi lengkap (Precision, Recall, F1-Score)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE predictions DROP CONSTRAINT IF EXISTS predictions_model_id_fkey;
ALTER TABLE predictions ADD CONSTRAINT predictions_model_id_fkey
  FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE RESTRICT;

-- 5. Tabel model_retrain_jobs
CREATE TABLE IF NOT EXISTS model_retrain_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID REFERENCES brands(id) ON DELETE CASCADE,
    status VARCHAR(50) DEFAULT 'pending' NOT NULL,         -- 'pending', 'running', 'success', 'failed'
    error_message TEXT,                                    -- Keterangan galat jika gagal
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE,
    finished_at TIMESTAMP WITH TIME ZONE                   -- Kompatibilitas alias untuk completed_at
);

-- Calendar content is planning data, not prediction history. Imported and
-- manually-created items live here and only appear for their owner.
CREATE TABLE IF NOT EXISTS calendar_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    brand_id UUID REFERENCES brands(id) ON DELETE SET NULL,
    posting_date DATE NOT NULL,
    posting_time TIME,
    content_type VARCHAR(100) NOT NULL,
    content_details TEXT,
    visual_reference TEXT,
    caption TEXT,
    voice_over VARCHAR(20),
    pic VARCHAR(255),
    status VARCHAR(50),
    source VARCHAR(20) DEFAULT 'manual' NOT NULL,
    prediction_id UUID REFERENCES predictions(id) ON DELETE RESTRICT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT calendar_voice_over_check CHECK (voice_over IS NULL OR voice_over IN ('Need', 'No Need', 'Done')),
    CONSTRAINT calendar_status_check CHECK (status IS NULL OR status IN ('Need Shooting', 'Need Design', 'Need Editing', 'Screening', 'Ready to Post', 'Posted')),
    CONSTRAINT calendar_source_check CHECK (source IN ('manual', 'import'))
);

ALTER TABLE calendar_entries DROP CONSTRAINT IF EXISTS calendar_entries_prediction_id_fkey;
ALTER TABLE calendar_entries ADD CONSTRAINT calendar_entries_prediction_id_fkey
  FOREIGN KEY (prediction_id) REFERENCES predictions(id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS content_lifecycle_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    brand_id UUID REFERENCES brands(id) ON DELETE SET NULL,
    prediction_id UUID REFERENCES predictions(id) ON DELETE RESTRICT,
    calendar_entry_id UUID REFERENCES calendar_entries(id) ON DELETE SET NULL,
    event_type VARCHAR(80) NOT NULL,
    source VARCHAR(30) DEFAULT 'database_trigger' NOT NULL,
    actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    metadata JSONB DEFAULT '{}'::jsonb NOT NULL,
    occurred_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE content_lifecycle_events DROP CONSTRAINT IF EXISTS content_lifecycle_events_prediction_id_fkey;
ALTER TABLE content_lifecycle_events ADD CONSTRAINT content_lifecycle_events_prediction_id_fkey
  FOREIGN KEY (prediction_id) REFERENCES predictions(id) ON DELETE RESTRICT;

-- Create Indexes for optimization
CREATE INDEX IF NOT EXISTS idx_posts_brand_id ON posts(brand_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_instagram_media
  ON posts(brand_id, instagram_media_id)
  WHERE instagram_media_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_posts_brand_verified_history
  ON posts(brand_id, created_at DESC)
  WHERE source = 'instagram_graph'
    AND instagram_media_id IS NOT NULL
    AND er IS NOT NULL
    AND post_hour IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_predictions_brand_id ON predictions(brand_id);
CREATE INDEX IF NOT EXISTS idx_predictions_created_by ON predictions(created_by);
CREATE INDEX IF NOT EXISTS idx_predictions_status ON predictions(created_by, prediction_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_predictions_supersedes ON predictions(supersedes_prediction_id) WHERE supersedes_prediction_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_predictions_one_successor ON predictions(supersedes_prediction_id) WHERE supersedes_prediction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_predictions_visible_history ON predictions(created_by, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_predictions_model_id ON predictions(model_id) WHERE model_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_predictions_input_hash ON predictions(created_by, input_hash) WHERE input_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_models_brand_id ON models(brand_id);
CREATE INDEX IF NOT EXISTS idx_models_niche ON models(niche);
CREATE INDEX IF NOT EXISTS idx_model_retrain_jobs_brand_id ON model_retrain_jobs(brand_id);
CREATE INDEX IF NOT EXISTS idx_lifecycle_events_owner_time ON content_lifecycle_events(owner_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_lifecycle_events_prediction ON content_lifecycle_events(prediction_id, occurred_at DESC) WHERE prediction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lifecycle_events_calendar ON content_lifecycle_events(calendar_entry_id, occurred_at DESC) WHERE calendar_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_brands_owner_id ON brands(owner_id);
CREATE INDEX IF NOT EXISTS idx_calendar_entries_owner_date ON calendar_entries(owner_id, posting_date);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'posts_source_check' AND conrelid = 'public.posts'::regclass
  ) THEN
    ALTER TABLE public.posts
      ADD CONSTRAINT posts_source_check
      CHECK (source IS NULL OR source = 'instagram_graph') NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'posts_media_product_type_check' AND conrelid = 'public.posts'::regclass
  ) THEN
    ALTER TABLE public.posts
      ADD CONSTRAINT posts_media_product_type_check
      CHECK (
        media_product_type IS NULL
        OR media_product_type IN ('FEED', 'REELS', 'STORY', 'AD', 'UNKNOWN')
      ) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'predictions_actual_source_check' AND conrelid = 'public.predictions'::regclass
  ) THEN
    ALTER TABLE public.predictions
      ADD CONSTRAINT predictions_actual_source_check
      CHECK (actual_source IS NULL OR actual_source = 'instagram_media_id') NOT VALID;
  END IF;
END $$;

COMMENT ON COLUMN public.posts.media_product_type IS
  'Normalized Meta media_product_type. VIDEO is modeled as Reels only when this value is REELS.';

-- Row-Level Security
-- RLS is enabled on every table. The ML service connects as the table owner
-- (DATABASE_URL) and is not affected. Browser/API access via supabase-js uses
-- these policies: every authenticated user sees only brands they own and the
-- dependent records belonging to those brands; anonymous visitors see nothing.
ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE models ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_retrain_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_lifecycle_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authenticated_read ON brands;
DROP POLICY IF EXISTS authenticated_insert_brands ON brands;
DROP POLICY IF EXISTS owner_select ON brands;
DROP POLICY IF EXISTS owner_insert ON brands;
DROP POLICY IF EXISTS owner_update ON brands;
DROP POLICY IF EXISTS owner_delete ON brands;
CREATE POLICY owner_select ON brands FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY owner_insert ON brands FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY owner_update ON brands FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY owner_delete ON brands FOR DELETE TO authenticated USING (owner_id = auth.uid());

DROP POLICY IF EXISTS authenticated_read ON posts;
DROP POLICY IF EXISTS owner_select ON posts;
CREATE POLICY owner_select ON posts FOR SELECT TO authenticated USING (
  source = 'instagram_graph'
  AND instagram_media_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM brands b WHERE b.id = posts.brand_id AND b.owner_id = auth.uid())
);

DROP POLICY IF EXISTS authenticated_read ON predictions;
DROP POLICY IF EXISTS owner_select ON predictions;
DROP POLICY IF EXISTS owner_update ON predictions;
DROP POLICY IF EXISTS owner_delete ON predictions;
CREATE POLICY owner_select ON predictions FOR SELECT TO authenticated USING (
  created_by = auth.uid() AND
  EXISTS (SELECT 1 FROM brands b WHERE b.id = predictions.brand_id AND b.owner_id = auth.uid())
);
CREATE POLICY owner_update ON predictions FOR UPDATE TO authenticated USING (
  created_by = auth.uid() AND
  EXISTS (SELECT 1 FROM brands b WHERE b.id = predictions.brand_id AND b.owner_id = auth.uid())
);
-- Prediction rows are immutable evidence. The authenticated API may rename or
-- soft-delete them, but hard deletion and scored-input rewrites are forbidden.
REVOKE UPDATE, DELETE ON public.predictions FROM authenticated;
GRANT UPDATE (title, deleted_at) ON public.predictions TO authenticated;
REVOKE INSERT, UPDATE ON public.brands FROM authenticated;
GRANT INSERT (owner_id, name, niche) ON public.brands TO authenticated;
GRANT UPDATE (name, niche) ON public.brands TO authenticated;

DROP POLICY IF EXISTS authenticated_read ON models;
DROP POLICY IF EXISTS owner_relevant_select ON models;
CREATE POLICY owner_relevant_select ON models FOR SELECT TO authenticated USING (
  metrics->>'data_source' = 'instagram_graph'
  AND metrics->>'identity_key' = 'instagram_media_id'
  AND ((brand_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM brands b WHERE b.id = models.brand_id AND b.owner_id = auth.uid()
  )) OR
  (brand_id IS NULL AND EXISTS (
    SELECT 1 FROM brands b WHERE b.owner_id = auth.uid() AND b.niche = models.niche
  )))
);

DROP POLICY IF EXISTS authenticated_read ON model_retrain_jobs;
DROP POLICY IF EXISTS owner_select ON model_retrain_jobs;
CREATE POLICY owner_select ON model_retrain_jobs FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM brands b WHERE b.id = model_retrain_jobs.brand_id AND b.owner_id = auth.uid())
);

DROP POLICY IF EXISTS owner_all ON calendar_entries;
CREATE POLICY owner_all ON calendar_entries FOR ALL TO authenticated
USING (owner_id = auth.uid())
WITH CHECK (
  owner_id = auth.uid()
  AND (brand_id IS NULL OR EXISTS (
    SELECT 1 FROM brands b WHERE b.id = calendar_entries.brand_id AND b.owner_id = auth.uid()
  ))
  AND (prediction_id IS NULL OR EXISTS (
    SELECT 1 FROM predictions p WHERE p.id = calendar_entries.prediction_id AND p.created_by = auth.uid()
  ))
);

DROP POLICY IF EXISTS lifecycle_owner_select ON content_lifecycle_events;
CREATE POLICY lifecycle_owner_select ON content_lifecycle_events FOR SELECT TO authenticated
USING (owner_id = auth.uid());
REVOKE ALL ON public.content_lifecycle_events FROM anon, authenticated;
GRANT SELECT ON public.content_lifecycle_events TO authenticated;
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
