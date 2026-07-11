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
    source VARCHAR(50),
    synced_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE posts ADD COLUMN IF NOT EXISTS instagram_media_id VARCHAR(255);
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
    model_version VARCHAR(50)        -- Version of the model that produced this prediction
);

ALTER TABLE predictions ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS actual_source VARCHAR(50);

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
    prediction_id UUID REFERENCES predictions(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT calendar_voice_over_check CHECK (voice_over IS NULL OR voice_over IN ('Need', 'No Need', 'Done')),
    CONSTRAINT calendar_status_check CHECK (status IS NULL OR status IN ('Need Shooting', 'Need Design', 'Need Editing', 'Screening', 'Ready to Post', 'Posted')),
    CONSTRAINT calendar_source_check CHECK (source IN ('manual', 'import'))
);

-- Create Indexes for optimization
CREATE INDEX IF NOT EXISTS idx_posts_brand_id ON posts(brand_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_instagram_media
  ON posts(brand_id, instagram_media_id)
  WHERE instagram_media_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_predictions_brand_id ON predictions(brand_id);
CREATE INDEX IF NOT EXISTS idx_predictions_created_by ON predictions(created_by);
CREATE INDEX IF NOT EXISTS idx_models_brand_id ON models(brand_id);
CREATE INDEX IF NOT EXISTS idx_models_niche ON models(niche);
CREATE INDEX IF NOT EXISTS idx_model_retrain_jobs_brand_id ON model_retrain_jobs(brand_id);
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
    WHERE conname = 'predictions_actual_source_check' AND conrelid = 'public.predictions'::regclass
  ) THEN
    ALTER TABLE public.predictions
      ADD CONSTRAINT predictions_actual_source_check
      CHECK (actual_source IS NULL OR actual_source = 'instagram_media_id') NOT VALID;
  END IF;
END $$;

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
CREATE POLICY owner_delete ON predictions FOR DELETE TO authenticated USING (
  created_by = auth.uid() AND
  EXISTS (SELECT 1 FROM brands b WHERE b.id = predictions.brand_id AND b.owner_id = auth.uid())
);

-- The authenticated PostgREST role may edit only user-authored metadata.
-- Model output/provenance remains writable solely by the privileged ML service.
REVOKE UPDATE ON public.predictions FROM authenticated;
GRANT UPDATE (title, caption, scheduled_date) ON public.predictions TO authenticated;
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
