-- Per-user ownership and dedicated content calendar.
-- Legacy rows remain quarantined until an administrator explicitly assigns
-- their owner after verifying their provenance.

ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS actual_source VARCHAR(50);

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS instagram_media_id VARCHAR(255);

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS source VARCHAR(50);

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;

ALTER TABLE public.brands ALTER COLUMN followers DROP DEFAULT;

UPDATE public.brands b
SET followers = NULL
WHERE followers = 0
  AND NOT EXISTS (SELECT 1 FROM public.posts p WHERE p.brand_id = b.id AND p.is_synced);

-- Keep legacy rows available to administrators while enforcing provenance on
-- every new or updated record.
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

CREATE TABLE IF NOT EXISTS public.calendar_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  brand_id UUID REFERENCES public.brands(id) ON DELETE SET NULL,
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
  prediction_id UUID REFERENCES public.predictions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT calendar_voice_over_check CHECK (voice_over IS NULL OR voice_over IN ('Need', 'No Need', 'Done')),
  CONSTRAINT calendar_status_check CHECK (status IS NULL OR status IN ('Need Shooting', 'Need Design', 'Need Editing', 'Screening', 'Ready to Post', 'Posted')),
  CONSTRAINT calendar_source_check CHECK (source IN ('manual', 'import'))
);

CREATE INDEX IF NOT EXISTS idx_brands_owner_id ON public.brands(owner_id);
CREATE INDEX IF NOT EXISTS idx_predictions_created_by ON public.predictions(created_by);
CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_instagram_media
  ON public.posts(brand_id, instagram_media_id)
  WHERE instagram_media_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_calendar_entries_owner_date
  ON public.calendar_entries(owner_id, posting_date);

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

ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_retrain_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authenticated_read ON public.brands;
DROP POLICY IF EXISTS authenticated_insert_brands ON public.brands;
DROP POLICY IF EXISTS owner_select ON public.brands;
DROP POLICY IF EXISTS owner_insert ON public.brands;
DROP POLICY IF EXISTS owner_update ON public.brands;
DROP POLICY IF EXISTS owner_delete ON public.brands;
CREATE POLICY owner_select ON public.brands FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY owner_insert ON public.brands FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY owner_update ON public.brands FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY owner_delete ON public.brands FOR DELETE TO authenticated USING (owner_id = auth.uid());

DROP POLICY IF EXISTS authenticated_read ON public.posts;
DROP POLICY IF EXISTS owner_select ON public.posts;
CREATE POLICY owner_select ON public.posts FOR SELECT TO authenticated USING (
  source = 'instagram_graph'
  AND instagram_media_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.brands b WHERE b.id = posts.brand_id AND b.owner_id = auth.uid())
);

DROP POLICY IF EXISTS authenticated_read ON public.predictions;
DROP POLICY IF EXISTS owner_select ON public.predictions;
DROP POLICY IF EXISTS owner_update ON public.predictions;
DROP POLICY IF EXISTS owner_delete ON public.predictions;
CREATE POLICY owner_select ON public.predictions FOR SELECT TO authenticated USING (
  created_by = auth.uid() AND
  EXISTS (SELECT 1 FROM public.brands b WHERE b.id = predictions.brand_id AND b.owner_id = auth.uid())
);
CREATE POLICY owner_update ON public.predictions FOR UPDATE TO authenticated USING (
  created_by = auth.uid() AND
  EXISTS (SELECT 1 FROM public.brands b WHERE b.id = predictions.brand_id AND b.owner_id = auth.uid())
);
CREATE POLICY owner_delete ON public.predictions FOR DELETE TO authenticated USING (
  created_by = auth.uid() AND
  EXISTS (SELECT 1 FROM public.brands b WHERE b.id = predictions.brand_id AND b.owner_id = auth.uid())
);

REVOKE UPDATE ON public.predictions FROM authenticated;
GRANT UPDATE (title, caption, scheduled_date) ON public.predictions TO authenticated;
REVOKE INSERT, UPDATE ON public.brands FROM authenticated;
GRANT INSERT (owner_id, name, niche) ON public.brands TO authenticated;
GRANT UPDATE (name, niche) ON public.brands TO authenticated;

DROP POLICY IF EXISTS authenticated_read ON public.models;
DROP POLICY IF EXISTS owner_relevant_select ON public.models;
CREATE POLICY owner_relevant_select ON public.models FOR SELECT TO authenticated USING (
  metrics->>'data_source' = 'instagram_graph'
  AND metrics->>'identity_key' = 'instagram_media_id'
  AND ((brand_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.brands b WHERE b.id = models.brand_id AND b.owner_id = auth.uid()
  )) OR
  (brand_id IS NULL AND EXISTS (
    SELECT 1 FROM public.brands b WHERE b.owner_id = auth.uid() AND b.niche = models.niche
  )))
);

DROP POLICY IF EXISTS authenticated_read ON public.model_retrain_jobs;
DROP POLICY IF EXISTS owner_select ON public.model_retrain_jobs;
CREATE POLICY owner_select ON public.model_retrain_jobs FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.brands b
    WHERE b.id = model_retrain_jobs.brand_id AND b.owner_id = auth.uid()
  )
);

DROP POLICY IF EXISTS owner_all ON public.calendar_entries;
CREATE POLICY owner_all ON public.calendar_entries FOR ALL TO authenticated
USING (owner_id = auth.uid())
WITH CHECK (
  owner_id = auth.uid()
  AND (brand_id IS NULL OR EXISTS (
    SELECT 1 FROM public.brands b
    WHERE b.id = calendar_entries.brand_id AND b.owner_id = auth.uid()
  ))
  AND (prediction_id IS NULL OR EXISTS (
    SELECT 1 FROM public.predictions p
    WHERE p.id = calendar_entries.prediction_id AND p.created_by = auth.uid()
  ))
);
