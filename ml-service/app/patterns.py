"""Brand-level descriptive pattern API router."""

import uuid

import psycopg2.extras
from fastapi import APIRouter, Depends, HTTPException

from app.brand_patterns import build_brand_patterns
from app.shared import get_db_connection, logger, verify_internal_token
from app.train_pipeline import MIN_POST_AGE_DAYS

router = APIRouter()


@router.get("/brand/patterns", dependencies=[Depends(verify_internal_token)])
def brand_patterns(brand_id: str):
    """Descriptive, brand-only planning evidence from verified mature posts.

    The authenticated Next.js BFF remains responsible for user/brand ownership
    checks. This internal endpoint additionally refuses unowned brands and
    returns aggregate evidence only—never captions or Instagram media IDs.
    """
    try:
        normalized_brand_id = str(uuid.UUID(brand_id))
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail="brand_id must be a valid UUID.") from exc

    conn = None
    try:
        conn = get_db_connection()
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """SELECT id, name, niche
                   FROM brands
                   WHERE id = %s AND owner_id IS NOT NULL
                   LIMIT 1""",
                (normalized_brand_id,),
            )
            brand = cur.fetchone()
            if not brand:
                raise HTTPException(status_code=404, detail="Brand was not found.")

            cur.execute(
                """SELECT caption, er, is_single_image, is_carousel, is_reels,
                          media_product_type, post_hour, caption_length,
                          hashtag_count, has_cta, created_at, synced_at
                   FROM posts
                   WHERE brand_id = %s
                     AND source = 'instagram_graph'
                     AND instagram_media_id IS NOT NULL
                     AND er IS NOT NULL
                     AND post_hour IS NOT NULL
                     AND created_at IS NOT NULL
                     AND created_at <= now() - (%s * interval '1 day')
                   ORDER BY created_at ASC, instagram_media_id ASC""",
                (normalized_brand_id, MIN_POST_AGE_DAYS),
            )
            rows = [dict(row) for row in cur.fetchall()]
        return build_brand_patterns(
            rows,
            brand_id=normalized_brand_id,
            brand_name=str(brand["name"]),
            niche=str(brand["niche"]),
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("Brand pattern lookup failed for brand %s", normalized_brand_id)
        raise HTTPException(
            status_code=503,
            detail="Brand performance patterns are temporarily unavailable.",
        )
    finally:
        if conn:
            conn.close()
