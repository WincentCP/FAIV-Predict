-- Preserve Meta's product classification so feed video is never mislabeled
-- as a Reel. Existing rows remain NULL until the next verified Graph sync;
-- training excludes those unverified video rows in the meantime.
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS media_product_type VARCHAR(50);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'posts_media_product_type_check'
      AND conrelid = 'public.posts'::regclass
  ) THEN
    ALTER TABLE public.posts
      ADD CONSTRAINT posts_media_product_type_check
      CHECK (
        media_product_type IS NULL
        OR media_product_type IN ('FEED', 'REELS', 'STORY', 'AD', 'UNKNOWN')
      ) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.posts
  VALIDATE CONSTRAINT posts_media_product_type_check;

CREATE INDEX IF NOT EXISTS idx_posts_brand_verified_history
  ON public.posts(brand_id, created_at DESC)
  WHERE source = 'instagram_graph'
    AND instagram_media_id IS NOT NULL
    AND er IS NOT NULL
    AND post_hour IS NOT NULL;

COMMENT ON COLUMN public.posts.media_product_type IS
  'Normalized Meta media_product_type. VIDEO is modeled as Reels only when this value is REELS.';
