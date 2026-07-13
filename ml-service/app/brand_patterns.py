"""Deterministic, brand-scoped descriptive patterns for pre-prediction planning.

These summaries never claim causality or demographic preference. They use only
verified, mature Instagram observations supplied by the caller and never return
captions or media identifiers.
"""

from __future__ import annotations

import datetime as dt
from collections import Counter, defaultdict
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

import numpy as np

from app.preprocessing import DataPreprocessor


MIN_GROUP_SAMPLES = 5
DIRECTIONAL_GROUP_SAMPLES = 15
MIN_TOTAL_FOR_HIGHLIGHT = 20
RECENT_PUBLISHING_WINDOW_DAYS = 90
MOMENTUM_WINDOW_DAYS = 90
RECENT_PERFORMANCE_UNAVAILABLE_REASON = (
    "Recent performance trend is unavailable because cumulative engagement rates "
    "were not captured at an equal post-age horizon. Fixed-horizon metric snapshots "
    "are required before recent and older posts can be compared fairly."
)
WIB = dt.timezone(dt.timedelta(hours=7))


def _timestamp(value: Any) -> Optional[dt.datetime]:
    if isinstance(value, dt.datetime):
        parsed = value
    elif isinstance(value, str):
        try:
            parsed = dt.datetime.fromisoformat(
                value.replace("Z", "+00:00").replace("+0000", "+00:00")
            )
        except ValueError:
            return None
    else:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)


def _percentile(values: List[float], percentile: float) -> float:
    return round(float(np.percentile(values, percentile)), 4)


def _evidence_level(sample_size: int) -> str:
    if sample_size < MIN_GROUP_SAMPLES:
        return "limited"
    if sample_size < DIRECTIONAL_GROUP_SAMPLES:
        return "exploratory"
    return "directional"


def _format_key(row: Dict[str, Any]) -> Tuple[str, str]:
    product_type = str(row.get("media_product_type") or "").upper()
    if bool(row.get("is_single_image")):
        return "single_image", "Single Image"
    if bool(row.get("is_carousel")):
        return "carousel", "Carousel"
    if bool(row.get("is_reels")) and product_type == "REELS":
        return "reels", "Reels"
    if product_type == "FEED":
        return "feed_video_unmodeled", "Feed Video (not modeled)"
    if bool(row.get("is_reels")):
        return "video_unverified", "Video (product type unverified)"
    return "unsupported", "Unsupported / unclassified"


def _is_modeled_format(row: Dict[str, Any]) -> bool:
    """Match the model-training supported-format predicate exactly."""
    return (
        bool(row.get("is_single_image"))
        or bool(row.get("is_carousel"))
        or (
            bool(row.get("is_reels"))
            and str(row.get("media_product_type") or "").upper() == "REELS"
        )
    )


def _daypart(hour: int) -> Tuple[str, str]:
    if 6 <= hour <= 10:
        return "morning", "Morning · 06:00–10:59 WIB"
    if 11 <= hour <= 14:
        return "midday", "Midday · 11:00–14:59 WIB"
    if 15 <= hour <= 17:
        return "afternoon", "Afternoon · 15:00–17:59 WIB"
    if 18 <= hour <= 22:
        return "evening", "Evening · 18:00–22:59 WIB"
    return "late_night", "Late night · 23:00–05:59 WIB"


def _caption_length_band(length: int) -> Tuple[str, str]:
    if length < 100:
        return "short", "Short · under 100 characters"
    if length < 300:
        return "medium", "Medium · 100–299 characters"
    return "long", "Long · 300+ characters"


def _hashtag_band(count: int) -> Tuple[str, str]:
    if count == 0:
        return "none", "No hashtags"
    if count <= 3:
        return "one_to_three", "1–3 hashtags"
    if count <= 8:
        return "four_to_eight", "4–8 hashtags"
    return "nine_plus", "9+ hashtags"


def _normalized_rows(rows: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    normalized = []
    for source in rows:
        try:
            er = float(source["er"])
            hour = int(source["post_hour"])
        except (KeyError, TypeError, ValueError):
            continue
        created_at = _timestamp(source.get("created_at"))
        if not np.isfinite(er) or er < 0 or created_at is None or not 0 <= hour <= 23:
            continue
        caption = str(source.get("caption") or "")
        extracted = DataPreprocessor.extract_features(
            caption=caption,
            format_type=_format_key(source)[1],
            post_hour=hour,
            is_weekend=created_at.astimezone(WIB).weekday() >= 5,
        )
        normalized.append({
            **source,
            "er": er,
            "post_hour": hour,
            "created_at": created_at,
            "synced_at": _timestamp(source.get("synced_at")),
            "caption_length": int(source.get("caption_length") or len(caption)),
            "hashtag_count": int(source.get("hashtag_count") or extracted["hashtag_count"]),
            "has_cta": bool(source.get("has_cta")),
            "has_question": bool(extracted["has_question"]),
            "has_emoji": extracted["emoji_count"] > 0,
        })
    normalized.sort(key=lambda row: row["created_at"])
    return normalized


def _build_groups(
    rows: List[Dict[str, Any]],
    classifier: Callable[[Dict[str, Any]], Tuple[str, str]],
    overall_median: float,
    p67: float,
) -> List[Dict[str, Any]]:
    grouped: Dict[Tuple[str, str], List[float]] = defaultdict(list)
    for row in rows:
        grouped[classifier(row)].append(row["er"])
    results = []
    for (key, label), values in grouped.items():
        values = sorted(values)
        median = _percentile(values, 50)
        results.append({
            "key": key,
            "label": label,
            "sample_size": len(values),
            "median_er": median,
            "q1_er": _percentile(values, 25),
            "q3_er": _percentile(values, 75),
            "difference_from_brand_median_pp": round(median - overall_median, 4),
            "high_tier_share": round(
                sum(value > p67 for value in values) / len(values), 4
            ),
            "evidence_level": _evidence_level(len(values)),
            "eligible_for_highlight": len(values) >= MIN_GROUP_SAMPLES,
        })
    return sorted(results, key=lambda item: (-item["sample_size"], item["label"]))


def _highlight(dimension: str, groups: List[Dict[str, Any]], total: int):
    eligible = [
        group for group in groups
        if group["eligible_for_highlight"]
        and group["key"] not in {"unsupported", "video_unverified", "feed_video_unmodeled"}
    ]
    if total < MIN_TOTAL_FOR_HIGHLIGHT or len(eligible) < 2:
        return None
    strongest = max(
        eligible,
        key=lambda item: (item["median_er"], item["sample_size"], item["label"]),
    )
    return {"dimension": dimension, **strongest}


def _window_summary(
    rows: List[Dict[str, Any]],
    *,
    start: dt.datetime,
    end: dt.datetime,
) -> Dict[str, Any]:
    """Summarize one half-open, equal-length publishing window.

    The returned mix is age-safe because it counts publication choices rather
    than comparing cumulative outcomes. ER distributions are retained only as
    explicitly confounded descriptive context in ``_build_momentum``.
    """
    window_rows = [row for row in rows if start <= row["created_at"] < end]
    format_counts = Counter(_format_key(row) for row in window_rows)
    total = len(window_rows)
    format_mix = [
        {
            "key": key,
            "label": label,
            "sample_size": count,
            "share": round(count / total, 4) if total else 0.0,
        }
        for (key, label), count in sorted(
            format_counts.items(), key=lambda item: item[0][1]
        )
    ]
    return {
        "start_at": start.isoformat(),
        "end_at": end.isoformat(),
        "posts": total,
        "format_mix": format_mix,
        "_rows": window_rows,
    }


def _group_er_distributions(
    rows: List[Dict[str, Any]],
    classifier: Callable[[Dict[str, Any]], Tuple[str, str]],
) -> Dict[Tuple[str, str], Dict[str, Any]]:
    grouped: Dict[Tuple[str, str], List[float]] = defaultdict(list)
    for row in rows:
        grouped[classifier(row)].append(row["er"])
    return {
        key: {
            "sample_size": len(values),
            "median_er": _percentile(values, 50),
            "q1_er": _percentile(values, 25),
            "q3_er": _percentile(values, 75),
        }
        for key, values in grouped.items()
    }


def _paired_er_context(
    recent_rows: List[Dict[str, Any]],
    prior_rows: List[Dict[str, Any]],
    classifier: Callable[[Dict[str, Any]], Tuple[str, str]],
) -> List[Dict[str, Any]]:
    recent = _group_er_distributions(recent_rows, classifier)
    prior = _group_er_distributions(prior_rows, classifier)
    output = []
    for key, label in sorted(set(recent) | set(prior), key=lambda item: item[1]):
        recent_value = recent.get((key, label))
        prior_value = prior.get((key, label))
        recent_median = recent_value["median_er"] if recent_value else None
        prior_median = prior_value["median_er"] if prior_value else None
        output.append({
            "key": key,
            "label": label,
            "recent": recent_value,
            "prior": prior_value,
            "median_difference_pp": (
                round(recent_median - prior_median, 4)
                if recent_median is not None and prior_median is not None
                else None
            ),
            "evidence_level": _evidence_level(min(
                recent_value["sample_size"] if recent_value else 0,
                prior_value["sample_size"] if prior_value else 0,
            )),
        })
    return output


def _build_momentum(
    rows: List[Dict[str, Any]],
    *,
    now_utc: dt.datetime,
) -> Dict[str, Any]:
    """Compare two equal 90-day windows without claiming recent ER uplift."""
    recent_start = now_utc - dt.timedelta(days=MOMENTUM_WINDOW_DAYS)
    prior_start = recent_start - dt.timedelta(days=MOMENTUM_WINDOW_DAYS)
    recent = _window_summary(rows, start=recent_start, end=now_utc)
    prior = _window_summary(rows, start=prior_start, end=recent_start)

    recent_mix = {item["key"]: item for item in recent["format_mix"]}
    prior_mix = {item["key"]: item for item in prior["format_mix"]}
    mix_changes = []
    for key in sorted(set(recent_mix) | set(prior_mix)):
        recent_item = recent_mix.get(key)
        prior_item = prior_mix.get(key)
        label = (recent_item or prior_item or {}).get("label", key)
        recent_share = recent_item["share"] if recent_item else 0.0
        prior_share = prior_item["share"] if prior_item else 0.0
        mix_changes.append({
            "key": key,
            "label": label,
            "recent_sample_size": recent_item["sample_size"] if recent_item else 0,
            "prior_sample_size": prior_item["sample_size"] if prior_item else 0,
            "recent_share": recent_share,
            "prior_share": prior_share,
            "share_change_pp": round((recent_share - prior_share) * 100, 2),
            "evidence_level": _evidence_level(min(
                recent_item["sample_size"] if recent_item else 0,
                prior_item["sample_size"] if prior_item else 0,
            )),
        })
    mix_changes.sort(key=lambda item: (-abs(item["share_change_pp"]), item["label"]))

    preferred_statements = []
    if recent["posts"] and prior["posts"]:
        statement_candidates = [
            item for item in mix_changes if item["evidence_level"] != "limited"
        ]
        for item in statement_candidates[:2]:
            direction = (
                "rose" if item["share_change_pp"] > 0
                else "fell" if item["share_change_pp"] < 0
                else "held"
            )
            connector = "from" if direction != "held" else "at"
            prior_percent = round(item["prior_share"] * 100)
            recent_percent = round(item["recent_share"] * 100)
            if direction == "held":
                statement = (
                    f"{item['label']} share of mature modeled posts held at "
                    f"{recent_percent}% (prior n={item['prior_sample_size']}; "
                    f"recent n={item['recent_sample_size']})."
                )
            else:
                statement = (
                    f"{item['label']} share of mature modeled posts {direction} {connector} "
                    f"{prior_percent}% to {recent_percent}% "
                    f"(prior n={item['prior_sample_size']}; recent n={item['recent_sample_size']})."
                )
            preferred_statements.append(statement)

    recent_rows = recent.pop("_rows")
    prior_rows = prior.pop("_rows")
    return {
        "window_days": MOMENTUM_WINDOW_DAYS,
        "recent_window": recent,
        "prior_window": prior,
        "format_mix_changes": mix_changes,
        "preferred_mix_statements": preferred_statements,
        "er_context": {
            "decision_use_allowed": False,
            "interpretation": "descriptive_only_age_confounded",
            "caveat": RECENT_PERFORMANCE_UNAVAILABLE_REASON,
            "formats": _paired_er_context(recent_rows, prior_rows, _format_key),
            "dayparts": _paired_er_context(
                recent_rows,
                prior_rows,
                lambda row: _daypart(row["post_hour"]),
            ),
        },
    }


def build_brand_patterns(
    rows: Iterable[Dict[str, Any]],
    *,
    brand_id: str,
    brand_name: str,
    niche: str,
    now: Optional[dt.datetime] = None,
) -> Dict[str, Any]:
    """Return safe descriptive evidence for one brand's planning workflow."""
    mature_verified = _normalized_rows(rows)
    normalized = [row for row in mature_verified if _is_modeled_format(row)]
    now_utc = (now or dt.datetime.now(dt.timezone.utc)).astimezone(dt.timezone.utc)
    unsupported = [
        {
            "key": "audience_demographics",
            "label": "Audience demographics",
            "reason": "Age, gender, and location aggregates are not collected by this system.",
        },
        {
            "key": "content_pillars",
            "label": "Content pillars",
            "reason": "Historical posts do not yet carry a reviewed content-pillar taxonomy.",
        },
        {
            "key": "visual_style",
            "label": "Visual and video style",
            "reason": "Historical media has not been consistently annotated or vision-analyzed.",
        },
        {
            "key": "hooks_storytelling",
            "label": "Hooks and storytelling",
            "reason": "Hook and narrative labels are not present in verified training history.",
        },
        {
            "key": "external_trends",
            "label": "External platform trends",
            "reason": "No sourced, region- and niche-specific external trend feed is connected.",
        },
    ]
    if not normalized:
        return {
            "status": "empty",
            "brand": {"id": brand_id, "name": brand_name, "niche": niche},
            "evidence": {
                "mature_verified_posts": len(mature_verified),
                "eligible_posts": 0,
                "excluded_unmodeled_posts": len(mature_verified),
                "minimum_group_samples": MIN_GROUP_SAMPLES,
                "minimum_highlight_total": MIN_TOTAL_FOR_HIGHLIGHT,
                "maturity_days": 7,
            },
            "overall": None,
            "patterns": {},
            "highlights": [],
            "freshness": {"status": "empty", "external_trends_included": False},
            "recent_publishing_mix": None,
            "brand_history_momentum": _build_momentum([], now_utc=now_utc),
            "not_measured": unsupported,
            "limitations": [
                (
                    "Mature verified history exists, but none of it has a format "
                    "supported by the prediction model."
                    if mature_verified
                    else "No mature verified Instagram history is available for this brand."
                )
            ],
        }

    ers = sorted(row["er"] for row in normalized)
    overall_median = _percentile(ers, 50)
    p67 = _percentile(ers, 67)
    pattern_classifiers = {
        "formats": _format_key,
        "dayparts": lambda row: _daypart(row["post_hour"]),
        "day_type": lambda row: (
            ("weekend", "Weekend")
            if row["created_at"].astimezone(WIB).weekday() >= 5
            else ("weekday", "Weekday")
        ),
        "cta": lambda row: (
            ("present", "CTA present") if row["has_cta"] else ("absent", "No CTA")
        ),
        "question": lambda row: (
            ("present", "Question present")
            if row["has_question"] else ("absent", "No question")
        ),
        "emoji": lambda row: (
            ("present", "Emoji present") if row["has_emoji"] else ("absent", "No emoji")
        ),
        "caption_length": lambda row: _caption_length_band(row["caption_length"]),
        "hashtags": lambda row: _hashtag_band(row["hashtag_count"]),
    }
    patterns = {
        dimension: _build_groups(
            normalized, classifier, overall_median, p67
        )
        for dimension, classifier in pattern_classifiers.items()
    }
    highlights = [
        value for value in (
            _highlight("format", patterns["formats"], len(normalized)),
            _highlight("posting_window", patterns["dayparts"], len(normalized)),
            _highlight("day_type", patterns["day_type"], len(normalized)),
            _highlight("cta", patterns["cta"], len(normalized)),
            _highlight("question", patterns["question"], len(normalized)),
        ) if value is not None
    ]

    first_post = normalized[0]["created_at"]
    last_post = normalized[-1]["created_at"]
    synced_values = [row["synced_at"] for row in normalized if row["synced_at"]]
    latest_sync = max(synced_values) if synced_values else None
    age_days = max(0, (now_utc - last_post).days)
    freshness_status = "current" if age_days <= 30 else ("aging" if age_days <= 90 else "stale")

    recent_start = now_utc - dt.timedelta(days=RECENT_PUBLISHING_WINDOW_DAYS)
    recent = [row for row in mature_verified if row["created_at"] >= recent_start]
    recent_eligible = [row for row in recent if _is_modeled_format(row)]
    recent_formats = Counter(_format_key(row)[1] for row in recent)
    recent_dayparts = Counter(_daypart(row["post_hour"])[1] for row in recent)
    momentum = _build_momentum(normalized, now_utc=now_utc)

    return {
        "status": "success",
        "brand": {"id": brand_id, "name": brand_name, "niche": niche},
        "evidence": {
            "mature_verified_posts": len(mature_verified),
            "eligible_posts": len(normalized),
            "excluded_unmodeled_posts": len(mature_verified) - len(normalized),
            "excluded_format_counts": dict(sorted(Counter(
                _format_key(row)[1]
                for row in mature_verified
                if not _is_modeled_format(row)
            ).items())),
            "first_post_at": first_post.isoformat(),
            "last_post_at": last_post.isoformat(),
            "latest_sync_at": latest_sync.isoformat() if latest_sync else None,
            "minimum_group_samples": MIN_GROUP_SAMPLES,
            "minimum_highlight_total": MIN_TOTAL_FOR_HIGHLIGHT,
            "maturity_days": 7,
            "outcome": "cumulative likes-plus-comments ER at latest sync",
            "source": "verified_instagram_graph_brand_history",
        },
        "overall": {
            "median_er": overall_median,
            "q1_er": _percentile(ers, 25),
            "q3_er": _percentile(ers, 75),
            "p33_er": _percentile(ers, 33),
            "p67_er": p67,
        },
        "patterns": patterns,
        "highlights": highlights,
        "freshness": {
            "status": freshness_status,
            "days_since_latest_mature_post": age_days,
            "weekly_sync_and_retraining": True,
            "historical_samples_equally_weighted": True,
            "external_trends_included": False,
            "seasonal_features_included": False,
            "note": (
                "Freshness reflects this brand's synced history. It is not a live "
                "platform-trend signal."
            ),
        },
        "recent_publishing_mix": {
            "window_days": RECENT_PUBLISHING_WINDOW_DAYS,
            "posts": len(recent),
            "eligible_modeled_posts": len(recent_eligible),
            "excluded_unmodeled_posts": len(recent) - len(recent_eligible),
            "format_counts": dict(sorted(recent_formats.items())),
            "daypart_counts": dict(sorted(recent_dayparts.items())),
            "performance_comparison_available": False,
            "reason": RECENT_PERFORMANCE_UNAVAILABLE_REASON,
        },
        "brand_history_momentum": momentum,
        "not_measured": unsupported,
        "limitations": [
            "Patterns are descriptive associations, not causal audience preferences.",
            "Small groups remain visible with limited-evidence labels but cannot become highlights.",
            "Prediction may use a cohort model even though these patterns are brand-only.",
            "External trends, audience demographics, and semantic visual attributes are not inferred.",
        ],
    }
