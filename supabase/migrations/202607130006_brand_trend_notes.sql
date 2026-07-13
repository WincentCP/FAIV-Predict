-- Persistent user-authored brand trend/context notes. These records are
-- advisory only and are never Random Forest inputs.

CREATE TABLE IF NOT EXISTS public.brand_trend_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  source TEXT NOT NULL,
  observed_at DATE NOT NULL,
  tag VARCHAR(80),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT brand_trend_notes_note_length_check
    CHECK (char_length(btrim(note)) BETWEEN 1 AND 300),
  CONSTRAINT brand_trend_notes_source_length_check
    CHECK (char_length(btrim(source)) BETWEEN 1 AND 200),
  CONSTRAINT brand_trend_notes_observed_at_check
    CHECK (observed_at <= CURRENT_DATE),
  CONSTRAINT brand_trend_notes_tag_length_check
    CHECK (tag IS NULL OR char_length(btrim(tag)) BETWEEN 1 AND 80)
);

CREATE INDEX IF NOT EXISTS idx_brand_trend_notes_brand_observed
  ON public.brand_trend_notes(brand_id, observed_at DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_brand_trend_notes_creator
  ON public.brand_trend_notes(created_by, created_at DESC);

ALTER TABLE public.brand_trend_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trend_notes_owner_select ON public.brand_trend_notes;
DROP POLICY IF EXISTS trend_notes_owner_insert ON public.brand_trend_notes;
DROP POLICY IF EXISTS trend_notes_owner_delete ON public.brand_trend_notes;
CREATE POLICY trend_notes_owner_select ON public.brand_trend_notes
FOR SELECT TO authenticated
USING (
  created_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.brands brand
    WHERE brand.id = brand_trend_notes.brand_id
      AND brand.owner_id = auth.uid()
  )
);
CREATE POLICY trend_notes_owner_insert ON public.brand_trend_notes
FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.brands brand
    WHERE brand.id = brand_trend_notes.brand_id
      AND brand.owner_id = auth.uid()
  )
);
CREATE POLICY trend_notes_owner_delete ON public.brand_trend_notes
FOR DELETE TO authenticated
USING (
  created_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.brands brand
    WHERE brand.id = brand_trend_notes.brand_id
      AND brand.owner_id = auth.uid()
  )
);

REVOKE ALL ON public.brand_trend_notes FROM anon, authenticated;
GRANT SELECT, DELETE ON public.brand_trend_notes TO authenticated;
GRANT INSERT (brand_id, note, source, observed_at, tag, created_by)
  ON public.brand_trend_notes TO authenticated;

COMMENT ON TABLE public.brand_trend_notes IS
  'Owner-scoped, user-provided and unverified brand context; advisory only and excluded from ML features.';

NOTIFY pgrst, 'reload schema';
