"""Instagram connection, posts, insights, synchronization, and health API router."""

import datetime
import json
import os
import re
import uuid
from typing import Any, Dict, Optional

import httpx
import psycopg2
import psycopg2.extras
from fastapi import APIRouter, Depends, HTTPException

from app.graph_client import (
    _fetch_ig_posts,
    _fetch_ig_profile,
    _instagram_sync_post_limit,
)
from app.preprocessing import DataPreprocessor
from app.shared import (
    InstagramIdentityBindingError,
    InstagramPostInsightsRequest,
    KNOWN_INSTAGRAM_PRODUCT_TYPES,
    MAX_INSTAGRAM_HEALTH_BRANDS,
    POST_COMPARISON_UNAVAILABLE_REASONS,
    RECENT_PERFORMANCE_UNAVAILABLE_REASON,
    SUPPORTED_INSTAGRAM_MEDIA_TYPES,
    logger,
    verify_internal_token,
)
from app.train_pipeline import MIN_ACCOUNT_TRAINING_SAMPLES, MIN_POST_AGE_DAYS, ModelTrainer

router = APIRouter()


def _get_brands_config() -> list[Dict[str, Any]]:
    """
    Instagram-connected brands configured through ``IG_BRANDS_JSON``.

    Every credential set must include the immutable database ``brand_id``.
    Name-based resolution is intentionally unsupported because two users can
    create brands with the same display name.
    """
    raw = os.getenv("IG_BRANDS_JSON")
    if not raw:
        return []

    try:
        entries = json.loads(raw)
        if not isinstance(entries, list):
            raise TypeError("expected a JSON array")

        normalized = []
        seen_brand_ids = set()
        seen_instagram_ids = set()
        for entry in entries:
            brand_id = str(entry["brand_id"])
            uuid.UUID(brand_id)
            instagram_id = str(entry["instagram_id"]).strip()
            access_token = str(entry["access_token"]).strip()
            if not instagram_id or not access_token:
                raise ValueError("instagram_id and access_token must be non-empty")
            if not re.fullmatch(r"[0-9]{5,64}", instagram_id):
                raise ValueError("instagram_id must be a numeric immutable account ID")
            if brand_id in seen_brand_ids:
                raise ValueError(f"duplicate brand_id: {brand_id}")
            if instagram_id in seen_instagram_ids:
                raise ValueError(f"duplicate instagram_id: {instagram_id}")
            seen_brand_ids.add(brand_id)
            seen_instagram_ids.add(instagram_id)
            normalized.append({
                "brand_id": brand_id,
                "instagram_id": instagram_id,
                "access_token": access_token,
            })
        return normalized
    except (ValueError, KeyError, TypeError) as exc:
        logger.error("IG_BRANDS_JSON is malformed: %s", exc)
        return []


def _bound_instagram_configs() -> list[Dict[str, Any]]:
    """Resolve configured credentials to existing database brands.

    This function never creates or claims a brand. Explicit UUID bindings are
    required. Unbound entries are returned with ``brand_id=None`` so health
    checks can report configuration problems without exposing the connection
    to a user-facing route.
    """
    configured = _get_brands_config()
    if not configured:
        return []

    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        return [{**entry, "brand_id": None, "binding_error": "DATABASE_URL is not configured"} for entry in configured]

    conn = None
    try:
        conn = psycopg2.connect(db_url)
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """SELECT id, name, niche, instagram_account_id
                   FROM brands WHERE owner_id IS NOT NULL"""
            )
            brands = [dict(row) for row in cur.fetchall()]
    except Exception as exc:
        logger.warning(f"Instagram configuration binding failed: {exc}")
        return [{**entry, "brand_id": None, "binding_error": "Database lookup failed"} for entry in configured]
    finally:
        if conn:
            conn.close()

    by_id = {str(brand["id"]): brand for brand in brands}
    bound = []
    for entry in configured:
        configured_id = str(entry.get("brand_id") or "")
        brand = by_id.get(configured_id) if configured_id else None

        persisted_instagram_id = (
            str(brand.get("instagram_account_id") or "") if brand else ""
        )
        if brand and persisted_instagram_id and persisted_instagram_id != entry["instagram_id"]:
            bound.append({
                **entry,
                "brand_id": None,
                "name": str(brand["name"]),
                "niche": str(brand["niche"]),
                "binding_error": (
                    "Configured instagram_id does not match this brand's persistent "
                    "Instagram account binding."
                ),
            })
        elif brand:
            bound.append({
                **entry,
                "brand_id": str(brand["id"]),
                "name": str(brand["name"]),
                "niche": str(brand["niche"]),
                "binding_error": None,
            })
        else:
            bound.append({**entry, "brand_id": None, "binding_error": "Configured brand_id does not exist"})
    return bound


def _get_instagram_connection(brand_id: str) -> Dict[str, Any]:
    matches = [entry for entry in _bound_instagram_configs() if entry.get("brand_id") == brand_id]
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        raise HTTPException(status_code=503, detail="Multiple Instagram connections target this brand. Fix IG_BRANDS_JSON.")
    raise HTTPException(status_code=404, detail="No Instagram connection is configured for this brand.")


def _parse_instagram_health_brand_ids(raw_brand_ids: Optional[str]) -> Optional[set[str]]:
    """Parse the BFF's comma-separated tenant scope.

    ``None`` is intentionally distinct from an empty string: an omitted query
    parameter is reserved for trusted operator diagnostics across configured
    connections, while ``brand_ids=`` is a valid user scope containing no
    brands. User-facing proxies must always send the parameter.
    """
    if raw_brand_ids is None:
        return None

    values = [value.strip() for value in raw_brand_ids.split(",") if value.strip()]
    if len(values) > MAX_INSTAGRAM_HEALTH_BRANDS:
        raise HTTPException(
            status_code=422,
            detail=f"At most {MAX_INSTAGRAM_HEALTH_BRANDS} brand_ids may be checked at once.",
        )

    parsed: set[str] = set()
    for value in values:
        try:
            parsed.add(str(uuid.UUID(value)))
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="brand_ids must contain valid UUIDs.") from exc
    return parsed


@router.get("/instagram/health", dependencies=[Depends(verify_internal_token)])
def instagram_health(brand_ids: Optional[str] = None):
    """
    Connection health for explicitly scoped Instagram-linked brands.

    User-facing BFFs must always pass ``brand_ids`` (including an empty value)
    so unrelated tenants are excluded before database and Graph API calls. An
    omitted parameter retains all-connection diagnostics for trusted operators
    calling this internal-token-protected service directly.
    """
    requested_brand_ids = _parse_instagram_health_brand_ids(brand_ids)
    configs = _bound_instagram_configs()
    if requested_brand_ids is not None:
        configs = [
            config
            for config in configs
            if config.get("brand_id") in requested_brand_ids
        ]

    connections = []
    last_synced: Dict[str, Optional[str]] = {}
    bound_brand_ids = [str(config["brand_id"]) for config in configs if config.get("brand_id")]
    db_url = os.getenv("DATABASE_URL")
    if db_url and bound_brand_ids:
        conn = None
        try:
            conn = psycopg2.connect(db_url)
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT b.id, MAX(p.synced_at)
                       FROM brands b
                       LEFT JOIN posts p
                         ON p.brand_id = b.id
                        AND p.source = 'instagram_graph'
                        AND p.instagram_media_id IS NOT NULL
                       WHERE b.id = ANY(%s::uuid[])
                       GROUP BY b.id""",
                    (bound_brand_ids,),
                )
                for brand_id, ts in cur.fetchall():
                    last_synced[str(brand_id)] = ts.isoformat() if ts else None
        except Exception as e:
            logger.warning(f"Instagram health: last-sync lookup failed: {e}")
        finally:
            if conn:
                conn.close()

    for config in configs:
        brand_id = config.get("brand_id")
        entry: Dict[str, Any] = {
            "brand_id": brand_id,
            "brand": config.get("name") or "Unbound connection",
            "niche": config.get("niche"),
            "last_synced": last_synced.get(str(brand_id)) if brand_id else None,
        }
        if not brand_id:
            entry.update({"status": "unbound", "error": config.get("binding_error")})
            connections.append(entry)
            continue
        try:
            with httpx.Client(timeout=10.0) as client:
                r = client.get(
                    f"https://graph.facebook.com/v25.0/{config['instagram_id']}",
                    params={"fields": "username,followers_count", "access_token": config["access_token"]},
                )
            if r.status_code == 200:
                data = r.json()
                entry.update({
                    "status": "connected",
                    "username": data.get("username"),
                    "followers": data.get("followers_count"),
                })
            else:
                detail = r.json().get("error", {}).get("message", r.text[:200])
                entry.update({"status": "error", "error": detail})
        except Exception:
            logger.exception("Instagram health check failed for brand %s", brand_id)
            entry.update({
                "status": "unreachable",
                "error": "Instagram Graph API could not be reached.",
            })
        connections.append(entry)

    return {"status": "success", "connections": connections}


@router.get("/instagram/posts", dependencies=[Depends(verify_internal_token)])
def instagram_posts(brand_id: str, limit: int = 24):
    """
    Live post insights for a linked brand: media previews, engagement
    metrics, and an ER tier graded against the brand's own synced history
    (same percentile method as training labels). Media URLs are fetched
    fresh on every call because Instagram CDN URLs expire.
    """
    config = _get_instagram_connection(brand_id)
    brand = config["name"]
    ig_id = config["instagram_id"]
    token = config["access_token"]
    followers = None
    media: list[Dict[str, Any]] = []
    live_available = True
    graph_failure_code = None
    try:
        followers = _fetch_ig_profile(ig_id, token)
        params = {
            "fields": "caption,like_count,comments_count,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp",
            "limit": min(max(limit, 1), 50),
            "access_token": token,
        }
        with httpx.Client(timeout=30.0) as client:
            r = client.get(f"https://graph.facebook.com/v25.0/{ig_id}/media", params=params)
            r.raise_for_status()
            media = r.json().get("data", [])
    except httpx.HTTPStatusError as e:
        live_available = False
        graph_failure_code = "graph_api_rejected_request"
        logger.warning(
            "Instagram live posts unavailable for brand %s: Graph HTTP %s",
            brand_id,
            e.response.status_code,
        )
    except Exception as exc:
        live_available = False
        graph_failure_code = "graph_api_unreachable"
        logger.warning(
            "Instagram live posts unavailable for brand %s: %s",
            brand_id,
            type(exc).__name__,
        )

    p33 = p67 = None
    synced_by_media: Dict[str, Dict[str, Any]] = {}
    stored_fallback_media: list[Dict[str, Any]] = []
    db_url = os.getenv("DATABASE_URL")
    if db_url:
        conn = None
        try:
            conn = psycopg2.connect(db_url)
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT p.id::text, p.instagram_media_id, p.er, p.synced_at,
                              (
                                p.created_at IS NOT NULL
                                AND p.created_at <= now() - (%s * interval '1 day')
                              ) AS is_mature,
                              (
                                p.is_single_image
                                OR p.is_carousel
                                OR (p.is_reels AND p.media_product_type = 'REELS')
                              ) AS is_modeled_format,
                              (p.post_hour IS NOT NULL) AS has_complete_features
                       FROM posts p
                       WHERE p.brand_id = %s
                         AND p.source = 'instagram_graph'
                         AND p.instagram_media_id IS NOT NULL""",
                    (MIN_POST_AGE_DAYS, brand_id),
                )
                for (
                    media_id,
                    instagram_media_id,
                    er,
                    synced_at,
                    is_mature,
                    is_modeled_format,
                    has_complete_features,
                ) in cur.fetchall():
                    numeric_er = float(er) if er is not None else None
                    comparison = _post_comparison_status(
                        has_sync=True,
                        er=numeric_er,
                        is_mature=bool(is_mature),
                        is_modeled_format=bool(is_modeled_format),
                        has_complete_features=bool(has_complete_features),
                    )
                    synced_by_media[str(instagram_media_id)] = {
                        "post_id": str(media_id),
                        "er": numeric_er,
                        "synced_at": synced_at.isoformat() if synced_at else None,
                        "comparison": comparison,
                    }
                cur.execute(
                    """SELECT percentile_cont(0.33) WITHIN GROUP (ORDER BY p.er),
                              percentile_cont(0.67) WITHIN GROUP (ORDER BY p.er)
                       FROM posts p
                       WHERE p.brand_id = %s
                         AND p.source = 'instagram_graph'
                         AND p.instagram_media_id IS NOT NULL
                         AND p.er IS NOT NULL
                         AND p.post_hour IS NOT NULL
                         AND p.created_at IS NOT NULL
                         AND p.created_at <= now() - (%s * interval '1 day')
                         AND (
                           p.is_single_image
                           OR p.is_carousel
                           OR (p.is_reels AND p.media_product_type = 'REELS')
                         )""",
                    (brand_id, MIN_POST_AGE_DAYS),
                )
                row = cur.fetchone()
                if row and row[0] is not None:
                    p33, p67 = float(row[0]), float(row[1])
                if not live_available:
                    cur.execute(
                        """SELECT p.id::text, p.instagram_media_id, p.caption,
                                  p.media_product_type, p.is_single_image,
                                  p.is_carousel, p.is_reels, p.created_at,
                                  b.followers
                           FROM posts p
                           JOIN brands b ON b.id = p.brand_id
                           WHERE p.brand_id = %s
                             AND p.source = 'instagram_graph'
                             AND p.instagram_media_id IS NOT NULL
                           ORDER BY p.created_at DESC, p.instagram_media_id DESC
                           LIMIT %s""",
                        (brand_id, min(max(limit, 1), 50)),
                    )
                    for (
                        post_id,
                        media_id,
                        caption,
                        media_product_type,
                        is_single_image,
                        is_carousel,
                        is_reels,
                        created_at,
                        stored_followers,
                    ) in cur.fetchall():
                        if followers is None and stored_followers is not None:
                            followers = int(stored_followers)
                        media_type = (
                            "IMAGE" if is_single_image
                            else "CAROUSEL_ALBUM" if is_carousel
                            else "VIDEO" if is_reels or media_product_type in {"FEED", "REELS"}
                            else None
                        )
                        stored_fallback_media.append({
                            "post_id": str(post_id),
                            "id": str(media_id),
                            "caption": caption or "",
                            "media_type": media_type,
                            "media_product_type": media_product_type,
                            "timestamp": created_at.isoformat() if created_at else None,
                            "_stored_only": True,
                        })
        except Exception as e:
            logger.warning(f"Post insights: percentile lookup failed: {e}")
        finally:
            if conn:
                conn.close()

    if not live_available:
        if not stored_fallback_media:
            raise HTTPException(
                status_code=502,
                detail="Instagram Graph API is unavailable and no stored verified history exists.",
            )
        media = stored_fallback_media

    posts = []
    for m in media:
        likes = m.get("like_count") if isinstance(m.get("like_count"), (int, float)) else None
        comments = m.get("comments_count") if isinstance(m.get("comments_count"), (int, float)) else None
        # Never rebase historical engagement onto today's follower count. The
        # stored ER preserves the follower snapshot captured by the verified
        # Instagram sync; media that has not been synced remains unavailable.
        synced = synced_by_media.get(str(m.get("id")))
        er = synced.get("er") if synced else None
        comparison = (
            synced.get("comparison")
            if synced
            else _post_comparison_status(
                has_sync=False,
                er=None,
                is_mature=False,
                is_modeled_format=False,
                has_complete_features=False,
            )
        )
        tier = None
        if p33 is not None and er is not None and comparison["eligible"]:
            tier = "Low" if er < p33 else ("Average" if er <= p67 else "High")
        posts.append({
            "post_id": m.get("post_id") or (synced.get("post_id") if synced else None),
            "id": m.get("id"),
            "caption": m.get("caption", ""),
            "media_type": m.get("media_type"),
            "media_product_type": m.get("media_product_type"),
            "media_url": m.get("media_url"),
            "thumbnail_url": m.get("thumbnail_url"),
            "permalink": m.get("permalink"),
            "timestamp": m.get("timestamp"),
            "likes": likes,
            "comments": comments,
            "er": er,
            "tier": tier,
            "comparison_eligible": comparison["eligible"],
            "comparison_unavailable_code": comparison["reason_code"],
            "comparison_unavailable_reason": comparison["reason"],
            "synced_at": synced.get("synced_at") if synced else None,
        })
    return {
        "status": "success" if live_available else "degraded",
        "brand_id": brand_id,
        "brand": brand,
        "followers": followers,
        "posts": posts,
        "provenance": {
            "live_source": "instagram_graph_api" if live_available else None,
            "synced_source": "production_database_instagram_graph_sync",
            "stored_only": not live_available,
            "degraded_reason_code": graph_failure_code,
            "fetched_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "post_limit": min(max(limit, 1), 50),
        },
    }


def _media_insight_value(payload: Dict[str, Any]) -> Optional[float]:
    data = payload.get("data") or []
    if not data:
        return None
    item = data[0]
    total = item.get("total_value") or {}
    if isinstance(total.get("value"), (int, float)):
        return float(total["value"])
    values = item.get("values") or []
    if values and isinstance(values[0].get("value"), (int, float)):
        return float(values[0]["value"])
    return None


def _media_insight_values(payload: Dict[str, Any]) -> Dict[str, float]:
    """Normalize Meta's lifetime insight response for one or many metrics."""
    result: Dict[str, float] = {}
    for item in payload.get("data") or []:
        name = item.get("name")
        if not isinstance(name, str):
            continue
        value = _media_insight_value({"data": [item]})
        if value is not None:
            result[name] = value
    return result


def _post_comparison_status(
    *,
    has_sync: bool,
    er: Optional[float],
    is_mature: bool,
    is_modeled_format: bool,
    has_complete_features: bool,
) -> Dict[str, Any]:
    """Return a stable eligibility flag and an honest unavailable reason."""
    reason_code = None
    if not has_sync or er is None:
        reason_code = "not_synced"
    elif not is_mature:
        reason_code = "immature"
    elif not is_modeled_format:
        reason_code = "unmodeled_format"
    elif not has_complete_features:
        reason_code = "incomplete_features"
    return {
        "eligible": reason_code is None,
        "reason_code": reason_code,
        "reason": (
            POST_COMPARISON_UNAVAILABLE_REASONS[reason_code]
            if reason_code is not None
            else None
        ),
    }


def _prediction_detail_payload(
    match: Dict[str, Any],
    *,
    match_method: str,
) -> Dict[str, Any]:
    realized_class = str(match.get("realized_class") or "").upper()
    realized_tier = (
        realized_class.title()
        if match.get("actual_source") == "instagram_media_id"
        and realized_class in {"LOW", "AVERAGE", "HIGH"}
        else None
    )
    realized_basis = match.get("realized_class_basis")
    if isinstance(realized_basis, str):
        try:
            realized_basis = json.loads(realized_basis)
        except ValueError:
            realized_basis = None
    if not isinstance(realized_basis, dict) or realized_tier is None:
        realized_basis = None
    return {
        "id": str(match["id"]),
        "tier": str(match["pred_class"]).title(),
        "actual_er": (
            float(match["actual_er"])
            if match.get("actual_source") == "instagram_media_id"
            and match.get("actual_er") is not None
            else None
        ),
        # This tier is never synthesized from a moving post population. It is
        # reconciled under the exact P33/P67 of the historical serving model.
        "realized_tier": realized_tier,
        "realized_class_basis": realized_basis,
        "confidence": (
            float(match["confidence"]) if match.get("confidence") else None
        ),
        "model_version": match.get("model_version"),
        "match_method": match_method,
        "publication_linked": bool(match.get("publication_linked")),
        "publication_matches_selected_media": bool(
            match.get("publication_matches_selected_media")
        ),
    }


@router.post("/instagram/post-insights", dependencies=[Depends(verify_internal_token)])
def instagram_post_insights(req: InstagramPostInsightsRequest):
    """Fetch supported lifetime metrics for one selected Instagram post.

    Meta exposes different metrics by media type and API version. We request
    the common media metrics in one call, then fall back to individual calls
    only if Meta rejects the mixed set. Unsupported metrics never become zero.
    """
    config = _get_instagram_connection(req.brand_id)
    token = config["access_token"]

    requested_metrics = [
        "reach", "impressions", "views", "saved", "shares",
        "total_interactions", "accounts_engaged",
    ]
    metrics: Dict[str, float] = {}
    unavailable = []
    insights_url = f"https://graph.facebook.com/v25.0/{req.media_id}/insights"
    with httpx.Client(timeout=15.0) as client:
        ownership = client.get(
            f"https://graph.facebook.com/v25.0/{req.media_id}",
            params={"fields": "id,owner,caption", "access_token": token},
        )
        if ownership.status_code != 200:
            raise HTTPException(status_code=404, detail="Instagram media was not found for this connection.")
        verified_media = ownership.json()
        owner_id = str((verified_media.get("owner") or {}).get("id") or "")
        if owner_id != str(config["instagram_id"]):
            raise HTTPException(status_code=404, detail="Instagram media does not belong to this brand.")
        verified_caption = verified_media.get("caption")

        try:
            combined = client.get(
                insights_url,
                params={"metric": ",".join(requested_metrics), "period": "lifetime", "access_token": token},
            )
            if combined.status_code == 200:
                metrics.update(_media_insight_values(combined.json()))
        except Exception:
            pass

        missing = [metric for metric in requested_metrics if metric not in metrics]
        # A mixed query can fail when one metric is unavailable for this media
        # type. Retry only the missing metrics to preserve the supported subset.
        for metric in missing:
            try:
                response = client.get(
                    insights_url,
                    params={"metric": metric, "period": "lifetime", "access_token": token},
                )
                if response.status_code != 200:
                    unavailable.append(metric)
                    continue
                value = _media_insight_value(response.json())
                if value is None:
                    unavailable.append(metric)
                else:
                    metrics[metric] = value
            except Exception:
                unavailable.append(metric)

    historical: Dict[str, Any] = {
        "brand_median_er": None,
        "brand_baseline_posts": 0,
        "brand_baseline_unavailable_reason": None,
        "comparison_eligible": False,
        "comparison_unavailable_code": "not_synced",
        "comparison_unavailable_reason": POST_COMPARISON_UNAVAILABLE_REASONS["not_synced"],
        "verified_post_id": None,
        "recent_performance": {
            "available": False,
            "reason_code": "fixed_horizon_snapshots_unavailable",
            "reason": RECENT_PERFORMANCE_UNAVAILABLE_REASON,
        },
    }
    prediction = None
    prediction_match_status = "not_found"
    db_url = os.getenv("DATABASE_URL")
    if db_url:
        conn = None
        try:
            conn = psycopg2.connect(db_url)
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """SELECT p.id::text AS post_id, p.er,
                              (
                                p.created_at IS NOT NULL
                                AND p.created_at <= now() - (%s * interval '1 day')
                              ) AS is_mature,
                              (
                                p.is_single_image
                                OR p.is_carousel
                                OR (p.is_reels AND p.media_product_type = 'REELS')
                              ) AS is_modeled_format,
                              (p.post_hour IS NOT NULL) AS has_complete_features
                       FROM posts p
                       WHERE p.brand_id = %s
                         AND p.source = 'instagram_graph'
                         AND p.instagram_media_id = %s
                       LIMIT 1""",
                    (MIN_POST_AGE_DAYS, req.brand_id, req.media_id),
                )
                selected_row = cur.fetchone()
                if selected_row:
                    historical["verified_post_id"] = selected_row.get("post_id")
                    selected_er = (
                        float(selected_row["er"])
                        if selected_row.get("er") is not None
                        else None
                    )
                    comparison = _post_comparison_status(
                        has_sync=True,
                        er=selected_er,
                        is_mature=bool(selected_row.get("is_mature")),
                        is_modeled_format=bool(selected_row.get("is_modeled_format")),
                        has_complete_features=bool(selected_row.get("has_complete_features")),
                    )
                    historical["comparison_eligible"] = comparison["eligible"]
                    historical["comparison_unavailable_code"] = comparison["reason_code"]
                    historical["comparison_unavailable_reason"] = comparison["reason"]

                    if comparison["eligible"]:
                        cur.execute(
                            """SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY p.er) AS brand_median_er,
                                      count(*) AS brand_baseline_posts
                               FROM posts p
                               WHERE p.brand_id = %s
                                 AND p.source = 'instagram_graph'
                                 AND p.instagram_media_id IS NOT NULL
                                 AND p.instagram_media_id <> %s
                                 AND p.er IS NOT NULL
                                 AND p.post_hour IS NOT NULL
                                 AND p.created_at IS NOT NULL
                                 AND p.created_at <= now() - (%s * interval '1 day')
                                 AND (
                                   p.is_single_image
                                   OR p.is_carousel
                                   OR (p.is_reels AND p.media_product_type = 'REELS')
                                 )""",
                            (req.brand_id, req.media_id, MIN_POST_AGE_DAYS),
                        )
                        baseline_row = cur.fetchone()
                        if baseline_row:
                            historical["brand_baseline_posts"] = int(
                                baseline_row.get("brand_baseline_posts") or 0
                            )
                            if baseline_row.get("brand_median_er") is not None:
                                historical["brand_median_er"] = float(
                                    baseline_row["brand_median_er"]
                                )
                            else:
                                historical["brand_baseline_unavailable_reason"] = (
                                    "No other mature, model-eligible posts are available "
                                    "for a brand-history baseline."
                                )

                # An immutable publication link wins over mutable caption text.
                # This remains resolvable after a caption edit or deletion.
                cur.execute(
                    """SELECT p.id::text AS id, p.pred_class, p.actual_er,
                              p.actual_source, p.realized_class,
                              p.realized_class_basis, p.model_version,
                              p.features->>'confidence' AS confidence,
                              true AS publication_linked,
                              true AS publication_matches_selected_media
                       FROM prediction_publications publication
                       JOIN predictions p ON p.id = publication.prediction_id
                       WHERE publication.brand_id = %s
                         AND publication.instagram_media_id = %s
                         AND publication.owner_id = %s
                         AND p.created_by = %s
                       LIMIT 1""",
                    (req.brand_id, req.media_id, req.created_by, req.created_by),
                )
                linked_match = cur.fetchone()
                if linked_match:
                    prediction_match_status = "verified_publication_link"
                    prediction = _prediction_detail_payload(
                        linked_match,
                        match_method="verified_media_id",
                    )

                if prediction is None and isinstance(verified_caption, str) and verified_caption.strip():
                    normalized = re.sub(r"\s+", " ", verified_caption.strip().lower())
                    cur.execute(
                            """SELECT p.id::text AS id, p.pred_class, p.actual_er,
                                  p.actual_source, p.realized_class,
                                  p.realized_class_basis, p.model_version,
                                  p.features->>'confidence' AS confidence,
                                  EXISTS (
                                    SELECT 1 FROM prediction_publications publication
                                    WHERE publication.prediction_id = p.id
                                  ) AS publication_linked,
                                  EXISTS (
                                    SELECT 1 FROM prediction_publications publication
                                    WHERE publication.prediction_id = p.id
                                      AND publication.instagram_media_id = %s
                                  ) AS publication_matches_selected_media
                           FROM predictions p
                           WHERE p.brand_id = %s AND p.created_by = %s
                             AND regexp_replace(lower(trim(coalesce(p.caption, ''))), '\\s+', ' ', 'g') = %s
                           ORDER BY p.created_at DESC LIMIT 2""",
                        (req.media_id, req.brand_id, req.created_by, normalized),
                    )
                    matches = cur.fetchall()
                    if len(matches) == 1:
                        match = matches[0]
                        prediction_match_status = "unique_verified_caption"
                        prediction = _prediction_detail_payload(
                            match,
                            match_method="verified_graph_caption_candidate",
                        )
                    elif len(matches) > 1:
                        prediction_match_status = "ambiguous_duplicate_caption"
        except Exception as exc:
            logger.warning(f"Post detail comparison lookup failed: {exc}")
            historical["comparison_eligible"] = False
            historical["comparison_unavailable_code"] = "lookup_unavailable"
            historical["comparison_unavailable_reason"] = (
                POST_COMPARISON_UNAVAILABLE_REASONS["lookup_unavailable"]
            )
        finally:
            if conn:
                conn.close()

    return {
        "status": "success",
        "metrics": metrics,
        "unavailable_metrics": sorted(set(unavailable)),
        # Meta's media-insights endpoint does not reliably attribute these
        # account-level actions to an individual organic post.
        "not_attributable_metrics": ["profile_visits", "follows"],
        "historical": historical,
        "prediction": prediction,
        "prediction_match_status": prediction_match_status,
        "provenance": {
            "live_source": "instagram_graph_api",
            "historical_source": "production_database_instagram_graph_sync",
            "prediction_source": "authenticated_user_prediction_history",
            "fetched_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        },
    }


def _normalized_media_product_type(post: Dict[str, Any]) -> str:
    """Return a constrained Meta product type without guessing future values."""
    value = str(post.get("media_product_type") or "").strip().upper()
    return value if value in KNOWN_INSTAGRAM_PRODUCT_TYPES else "UNKNOWN"


def _model_format_for_media(media_type: str, product_type: str) -> Optional[str]:
    """Map Graph media to the three formats supported by the trained model.

    ``media_type=VIDEO`` is not enough to identify a Reel: Meta also reports
    feed video as VIDEO. Only the explicit REELS product classification may set
    the Reels feature. Stories, ads, feed videos, and unknown videos are stored
    for descriptive history but excluded from model training.
    """
    if product_type in {"STORY", "AD"}:
        return None
    if media_type == "IMAGE":
        return "Single Image"
    if media_type == "CAROUSEL_ALBUM":
        return "Carousel"
    if media_type == "VIDEO" and product_type == "REELS":
        return "Reels"
    return None


def _bind_instagram_identity(
    cur,
    *,
    brand_id: str,
    instagram_account_id: str,
    followers: int,
) -> None:
    """Atomically establish or verify a brand's immutable Graph identity."""
    try:
        cur.execute(
            """UPDATE brands
               SET followers = %s,
                   instagram_account_id = COALESCE(instagram_account_id, %s)
               WHERE id = %s
                 AND owner_id IS NOT NULL
                 AND (
                   instagram_account_id IS NULL
                   OR instagram_account_id = %s
                 )
               RETURNING instagram_account_id""",
            (followers, instagram_account_id, brand_id, instagram_account_id),
        )
    except psycopg2.IntegrityError as exc:
        raise InstagramIdentityBindingError(
            "This Instagram account is already bound to another brand."
        ) from exc
    if cur.fetchone() is None:
        raise InstagramIdentityBindingError(
            "Configured Instagram account does not match the brand's persistent binding."
        )


def _reconcile_prediction_publications(cur, brand_id: str) -> int:
    """Refresh mature ER and its serving-model tier; the DB enforces provenance."""
    cur.execute(
        "SELECT public.reconcile_prediction_publication_outcomes(%s::uuid)",
        (brand_id,),
    )
    row = cur.fetchone()
    if not row:
        return 0
    if isinstance(row, dict):
        value = next(iter(row.values()), 0)
    else:
        value = row[0]
    return int(value or 0)


def _upsert_instagram_media(cur, brand_id: str, post: Dict[str, Any], current_followers: int) -> str:
    """Insert or refresh one Graph API media row without deleting history.

    The immutable Instagram media ID is the identity key. On the first run
    after migration, one legacy row may be claimed only when both timestamp
    and caption match exactly. The first observed follower denominator is
    preserved; for posts imported long after publication this is an explicit
    proxy, not a historical follower-at-publication measurement.
    """
    media_id = str(post["id"])
    caption = post.get("caption") or ""
    timestamp = str(post["timestamp"])
    likes = float(post["like_count"])
    comments = float(post["comments_count"])
    media_type = post.get("media_type", "IMAGE")
    if media_type not in SUPPORTED_INSTAGRAM_MEDIA_TYPES:
        raise ValueError(f"Unsupported Instagram media type: {media_type!r}")
    media_product_type = _normalized_media_product_type(post)
    ts_clean = timestamp.replace("Z", "+00:00").replace("+0000", "+00:00")
    dt_utc = datetime.datetime.fromisoformat(ts_clean)
    dt_wib = dt_utc + datetime.timedelta(hours=7)
    post_hour = dt_wib.hour
    format_type = _model_format_for_media(media_type, media_product_type)
    # The synchronization path and prediction path share the same authoritative
    # extractor. This prevents a model from being trained on feature semantics
    # that differ from the values used during inference.
    extracted = DataPreprocessor.extract_features(
        caption=caption,
        format_type=format_type or "Unsupported",
        post_hour=post_hour,
        is_weekend=dt_wib.weekday() >= 5,
    )

    cur.execute(
        """SELECT id, follower_count_at_post FROM posts
           WHERE brand_id = %s AND instagram_media_id = %s
           LIMIT 1""",
        (brand_id, media_id),
    )
    existing = cur.fetchone()
    result = "updated"
    if not existing:
        cur.execute(
            """SELECT id, follower_count_at_post FROM posts
               WHERE brand_id = %s
                 AND instagram_media_id IS NULL
                 AND source IS NULL
                 AND created_at = %s
                 AND caption IS NOT DISTINCT FROM %s
               ORDER BY id LIMIT 1""",
            (brand_id, timestamp, caption),
        )
        existing = cur.fetchone()
        result = "claimed" if existing else "inserted"

    denominator = (
        int(existing[1])
        if existing and isinstance(existing[1], (int, float)) and existing[1] > 0
        else current_followers
    )
    er = round(((likes + comments) / denominator) * 100, 4)
    values = (
        media_id, media_product_type, caption, er, denominator,
        bool(extracted["is_single_image"]),
        bool(extracted["is_carousel"]),
        bool(extracted["is_reels"]),
        int(extracted["post_hour"]),
        int(extracted["caption_length"]),
        int(extracted["hashtag_count"]),
        bool(extracted["has_cta"]),
        timestamp,
    )

    if existing:
        cur.execute(
            """UPDATE posts SET
                 instagram_media_id = %s, source = 'instagram_graph',
                 media_product_type = %s, caption = %s, er = %s, is_synced = true,
                 follower_count_at_post = %s,
                 is_single_image = %s, is_carousel = %s, is_reels = %s,
                 post_hour = %s, caption_length = %s, hashtag_count = %s,
                 has_cta = %s, created_at = %s,
                 synced_at = timezone('utc'::text, now())
               WHERE id = %s""",
            (*values, existing[0]),
        )
    else:
        cur.execute(
            """INSERT INTO posts (
                 brand_id, instagram_media_id, media_product_type, source, caption, er, is_synced,
                 follower_count_at_post, is_single_image, is_carousel, is_reels,
                 post_hour, caption_length, hashtag_count, has_cta, created_at, synced_at
               ) VALUES (
                 %s, %s, %s, 'instagram_graph', %s, %s, true,
                 %s, %s, %s, %s, %s, %s, %s, %s, %s,
                 timezone('utc'::text, now())
               )""",
            (brand_id, *values),
        )
    return result


def _sync_and_retrain_pipeline():
    """Sync configured Instagram accounts and train the appropriate model.

    Connections must already be bound to an existing brand; sync never creates
    user-facing rows. Accounts with at least 200 eligible, mature posts train a
    personal model. Smaller accounts contribute to one shared cohort model per run.
    """
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        return {"status": "error", "message": "DATABASE_URL not configured"}

    try:
        post_limit = _instagram_sync_post_limit()
    except ValueError as exc:
        return {
            "status": "error",
            "message": str(exc),
            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "results": [],
        }

    brands_config = _bound_instagram_configs()
    if not brands_config:
        return {
            "status": "error",
            "message": "No Instagram connections are configured.",
            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "results": [],
        }
    results = []

    for config in brands_config:
        name = config.get("name") or "Unbound connection"
        niche = config.get("niche")
        brand_id = config.get("brand_id")
        brand_result = {"brand": name, "niche": niche, "sync": {}, "train": {}}
        if not brand_id:
            brand_result["sync"] = {
                "status": "failed",
                "error": config.get("binding_error") or "Instagram connection is not bound to a brand",
            }
            results.append(brand_result)
            continue

        conn = None
        try:
            followers = _fetch_ig_profile(config["instagram_id"], config["access_token"])
            brand_result["sync"]["followers"] = followers
            if not followers or followers <= 0:
                raise ValueError(
                    "Instagram returned no usable follower denominator; refusing to write fabricated 0% engagement rates."
                )

            posts, history_truncated_by_limit = _fetch_ig_posts(
                config["instagram_id"],
                config["access_token"],
                limit=post_limit,
            )
            valid_posts = [
                post for post in posts
                if isinstance(post.get("like_count"), (int, float))
                and isinstance(post.get("comments_count"), (int, float))
                and post.get("id")
                and post.get("timestamp")
                and post.get("media_type") in SUPPORTED_INSTAGRAM_MEDIA_TYPES
            ]
            if not valid_posts:
                raise ValueError("Instagram returned no posts with complete supported media, engagement, and timestamp fields; existing history was preserved.")
            if len(valid_posts) != len(posts):
                logger.warning(f"Skipping {len(posts) - len(valid_posts)} incomplete Instagram media rows for {name}.")
            conn = psycopg2.connect(db_url)
            sync_counts = {"inserted": 0, "updated": 0, "claimed": 0}
            with conn.cursor() as cur:
                # This row lock serializes concurrent syncs for the same brand
                # until the media upserts commit. It also establishes the
                # immutable account binding on first verified synchronization.
                _bind_instagram_identity(
                    cur,
                    brand_id=brand_id,
                    instagram_account_id=str(config["instagram_id"]),
                    followers=followers,
                )
                for post in valid_posts:
                    sync_result = _upsert_instagram_media(cur, brand_id, post, followers)
                    sync_counts[sync_result] += 1
                reconciled_outcomes = _reconcile_prediction_publications(cur, brand_id)
                cur.execute(
                    """SELECT COUNT(*),
                              COUNT(*) FILTER (
                                WHERE er IS NOT NULL
                                  AND post_hour IS NOT NULL
                                  AND created_at IS NOT NULL
                                  AND created_at <= now() - (%s * interval '1 day')
                              ),
                              COUNT(*) FILTER (
                                WHERE er IS NOT NULL
                                  AND post_hour IS NOT NULL
                                  AND created_at IS NOT NULL
                                  AND created_at <= now() - (%s * interval '1 day')
                                  AND (
                                    is_single_image
                                    OR is_carousel
                                    OR (is_reels AND media_product_type = 'REELS')
                                  )
                              )
                       FROM posts
                       WHERE brand_id = %s
                         AND source = 'instagram_graph'
                         AND instagram_media_id IS NOT NULL""",
                    (MIN_POST_AGE_DAYS, MIN_POST_AGE_DAYS, brand_id),
                )
                stored_count, mature_history_count, mature_count = (
                    int(value) for value in cur.fetchone()
                )
            conn.commit()
            conn.close()
            conn = None
            brand_result["sync"]["posts_received"] = len(posts)
            brand_result["sync"]["configured_post_limit"] = post_limit
            brand_result["sync"]["history_truncated_by_limit"] = (
                history_truncated_by_limit
            )
            brand_result["sync"]["posts_synced"] = len(valid_posts)
            brand_result["sync"]["posts_inserted"] = sync_counts["inserted"]
            brand_result["sync"]["posts_updated"] = sync_counts["updated"]
            brand_result["sync"]["legacy_rows_claimed"] = sync_counts["claimed"]
            brand_result["sync"]["stored_verified_posts"] = stored_count
            brand_result["sync"]["mature_history_posts"] = mature_history_count
            brand_result["sync"]["mature_training_posts"] = mature_count
            brand_result["sync"]["excluded_unmodeled_mature_posts"] = (
                mature_history_count - mature_count
            )
            brand_result["sync"]["prediction_outcomes_reconciled"] = reconciled_outcomes
            brand_result["sync"]["status"] = "success"
            logger.info(
                f"[n8n Sync] {name}: {len(valid_posts)}/{len(posts)} posts synced "
                f"({sync_counts['inserted']} inserted, {sync_counts['updated']} updated, "
                f"{sync_counts['claimed']} legacy rows claimed)."
            )

            try:
                if mature_count >= MIN_ACCOUNT_TRAINING_SAMPLES:
                    train_scope = "personal"
                    train_result = ModelTrainer.run_training(brand_id=brand_id)
                else:
                    brand_result["train"] = {
                        "status": "pending",
                        "scope": "cohort",
                        "reason": "Cohort training runs after every configured brand has synced.",
                    }
                    results.append(brand_result)
                    continue
                brand_result["train"] = {
                    "status": "success",
                    "scope": train_scope,
                    "accuracy": train_result["metrics"]["accuracy"],
                    "f1_score": train_result["metrics"]["f1_score"],
                    "model_filename": train_result["model_filename"]
                }
                logger.info(f"[n8n Train] {name} ({train_scope}): accuracy={train_result['metrics']['accuracy']:.2%}")
            except Exception:
                logger.exception("Personal model training failed for brand %s", brand_id)
                brand_result["train"] = {
                    "status": "failed",
                    "error": "Model training failed. Inspect the ML service logs for the cause.",
                }

        except InstagramIdentityBindingError as exc:
            logger.error("Instagram identity binding rejected for brand %s", brand_id)
            brand_result["sync"]["status"] = "failed"
            brand_result["sync"]["error"] = str(exc)
        except httpx.HTTPStatusError as exc:
            logger.error(
                "Instagram synchronization failed for brand %s: Graph API HTTP %s",
                brand_id,
                exc.response.status_code,
            )
            brand_result["sync"]["status"] = "failed"
            brand_result["sync"]["error"] = (
                "Instagram Graph API rejected the synchronization request. "
                "Inspect the token and app permissions."
            )
        except httpx.RequestError as exc:
            logger.error(
                "Instagram synchronization failed for brand %s: Graph request %s",
                brand_id,
                type(exc).__name__,
            )
            brand_result["sync"]["status"] = "failed"
            brand_result["sync"]["error"] = (
                "Instagram Graph API request failed or timed out. Retry after "
                "checking connectivity."
            )
        except Exception:
            logger.exception("Instagram synchronization failed for brand %s", brand_id)
            brand_result["sync"]["status"] = "failed"
            brand_result["sync"]["error"] = (
                "Instagram synchronization failed. Inspect the ML service logs for the cause."
            )
        finally:
            if conn:
                conn.close()

        results.append(brand_result)

    # Train each shared cohort once, after all connected brands have synced, so
    # model input never depends on connection ordering.
    pending_niches = {
        result.get("niche")
        for result in results
        if result.get("train", {}).get("status") == "pending" and result.get("niche")
    }
    for pending_niche in pending_niches:
        try:
            train_result = ModelTrainer.run_training(niche=pending_niche)
            cohort_train = {
                "status": "success",
                "scope": "cohort",
                "accuracy": train_result["metrics"]["accuracy"],
                "f1_score": train_result["metrics"]["f1_score"],
                "model_filename": train_result["model_filename"],
            }
        except Exception:
            logger.exception("Cohort model training failed for niche %s", pending_niche)
            cohort_train = {
                "status": "failed",
                "scope": "cohort",
                "error": "Cohort model training failed. Inspect the ML service logs for the cause.",
            }
        for result in results:
            if (
                result.get("niche") == pending_niche
                and result.get("train", {}).get("status") == "pending"
            ):
                result["train"] = dict(cohort_train)

    # A connected brand without a cohort cannot be trained and must not leave
    # a misleading pending status in an otherwise completed run.
    for result in results:
        if result.get("train", {}).get("status") == "pending":
            result["train"] = {
                "status": "failed",
                "scope": "cohort",
                "error": "The brand has no supported industry cohort.",
            }

    fully_successful = all(
        result.get("sync", {}).get("status") == "success"
        and result.get("train", {}).get("status") == "success"
        for result in results
    )
    return {
        "status": "success" if fully_successful else "partial",
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "results": results,
    }


@router.post("/sync/now", dependencies=[Depends(verify_internal_token)])
def sync_instagram_data_now():
    """
    n8n Orchestration Endpoint (Synchronous).
    Blocks until full sync + retrain pipeline completes. Used by n8n for chaining nodes.
    """
    return _sync_and_retrain_pipeline()
