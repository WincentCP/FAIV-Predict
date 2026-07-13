"""Bounded, credential-safe Instagram Graph API client helpers."""

import os
from typing import Any, Optional
from urllib.parse import parse_qs, urlparse

import httpx

from app.shared import (
    DEFAULT_INSTAGRAM_SYNC_POST_LIMIT,
    INSTAGRAM_GRAPH_PAGE_SIZE,
    MAX_INSTAGRAM_SYNC_POST_LIMIT,
)


def _fetch_ig_profile(ig_id: str, token: str) -> Optional[int]:
    url = f"https://graph.facebook.com/v25.0/{ig_id}"
    params = {"fields": "followers_count", "access_token": token}
    with httpx.Client(timeout=15.0) as client:
        r = client.get(url, params=params)
        r.raise_for_status()
        followers = r.json().get("followers_count")
        return int(followers) if isinstance(followers, (int, float)) and followers >= 0 else None

def _validate_instagram_sync_post_limit(value: Any) -> int:
    """Validate the operator-controlled historical media cap.

    A finite upper bound prevents one workflow execution from walking an
    unexpectedly large account history and exhausting Meta/API resources.
    """
    try:
        limit = int(str(value).strip())
    except (TypeError, ValueError) as exc:
        raise ValueError("IG_SYNC_POST_LIMIT must be an integer") from exc
    if not 1 <= limit <= MAX_INSTAGRAM_SYNC_POST_LIMIT:
        raise ValueError(
            "IG_SYNC_POST_LIMIT must be between 1 and "
            f"{MAX_INSTAGRAM_SYNC_POST_LIMIT}"
        )
    return limit


def _instagram_sync_post_limit() -> int:
    return _validate_instagram_sync_post_limit(
        os.getenv("IG_SYNC_POST_LIMIT", str(DEFAULT_INSTAGRAM_SYNC_POST_LIMIT))
    )


def _fetch_ig_posts(
    ig_id: str,
    token: str,
    limit: Optional[int] = None,
) -> tuple[list, bool]:
    """Fetch bounded history and report whether the cap actually truncated it."""
    resolved_limit = _instagram_sync_post_limit() if limit is None else (
        _validate_instagram_sync_post_limit(limit)
    )
    url = f"https://graph.facebook.com/v25.0/{ig_id}/media"
    base_params = {
        "fields": "caption,like_count,comments_count,media_type,media_product_type,timestamp",
        # Request bounded pages and follow Meta's opaque `next` URL until the
        # configured total is reached. Do not assume Meta accepts the total cap
        # as one page size.
        "limit": min(resolved_limit, INSTAGRAM_GRAPH_PAGE_SIZE),
        "access_token": token,
    }
    params = dict(base_params)
    posts = []
    history_truncated_by_limit = False
    with httpx.Client(timeout=30.0) as client:
        while url and len(posts) < resolved_limit:
            r = client.get(url, params=params)
            r.raise_for_status()
            res = r.json()
            if not isinstance(res, dict):
                raise ValueError("Instagram media response must be a JSON object")
            page = res.get("data", [])
            if not isinstance(page, list):
                raise ValueError("Instagram media response data must be a JSON array")
            posts.extend(page)
            paging = res.get("paging", {})
            if not isinstance(paging, dict):
                raise ValueError("Instagram media response paging must be a JSON object")
            next_url = paging.get("next")
            after = (paging.get("cursors") or {}).get("after")
            if not after and next_url:
                # Some Graph responses include the cursor only in `next`.
                # Recover it without trusting that URL to retain credentials.
                after_values = parse_qs(urlparse(str(next_url)).query).get("after")
                after = after_values[-1] if after_values else None
            has_next_page = bool(next_url or after)
            if len(posts) >= resolved_limit:
                history_truncated_by_limit = has_next_page or (
                    len(posts) > resolved_limit
                )
                break
            if not page or not has_next_page:
                break
            if not after:
                raise ValueError(
                    "Instagram pagination advertised another page without a usable cursor"
                )
            # Always call the known endpoint with the original fields/token and
            # the opaque cursor. Meta's `next` URL is not assumed to retain auth.
            params = {**base_params, "after": str(after)}
    return posts[:resolved_limit], history_truncated_by_limit
