"""Shared configuration, request schemas, authentication, and database helpers."""

import logging
import os
import secrets
import uuid
from typing import Literal, Optional

import psycopg2
from dotenv import load_dotenv
from fastapi import Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# Load service-local defaults without overriding values supplied by the runtime.
env_path = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    ".env",
)
load_dotenv(env_path)

MAX_INSTAGRAM_HEALTH_BRANDS = 100
SUPPORTED_INSTAGRAM_MEDIA_TYPES = {"IMAGE", "CAROUSEL_ALBUM", "VIDEO"}
KNOWN_INSTAGRAM_PRODUCT_TYPES = {"FEED", "REELS", "STORY", "AD"}
POST_COMPARISON_UNAVAILABLE_REASONS = {
    "not_synced": "This post has no verified synchronized engagement rate yet.",
    "immature": "This post is younger than the required seven-day maturity window.",
    "unmodeled_format": "This post's media format is not supported by the prediction model.",
    "incomplete_features": "This synchronized post is missing features required for a like-for-like model comparison.",
    "lookup_unavailable": "Comparison eligibility could not be verified from synchronized history.",
}
RECENT_PERFORMANCE_UNAVAILABLE_REASON = (
    "Recent performance trend is unavailable because cumulative engagement rates "
    "were not captured at an equal post-age horizon. Fixed-horizon metric snapshots "
    "are required before recent and older posts can be compared fairly."
)
DEFAULT_INSTAGRAM_SYNC_POST_LIMIT = 500
MAX_INSTAGRAM_SYNC_POST_LIMIT = 1000
INSTAGRAM_GRAPH_PAGE_SIZE = 100
STALE_RETRAIN_JOB_MINUTES = 30
UNKNOWN_TIME_SCENARIOS = tuple(range(24))

logger = logging.getLogger("main")
logging.basicConfig(level=logging.INFO)
# Meta access tokens are query parameters, so suppress client request logging.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

INTERNAL_API_TOKEN = os.getenv("INTERNAL_API_TOKEN")
ALLOW_UNAUTHENTICATED_LOCAL_DEV = os.getenv(
    "ALLOW_UNAUTHENTICATED_LOCAL_DEV", "false"
).lower() == "true"
if not INTERNAL_API_TOKEN and not ALLOW_UNAUTHENTICATED_LOCAL_DEV:
    raise RuntimeError(
        "INTERNAL_API_TOKEN is required. Set an explicit shared secret, or set "
        "ALLOW_UNAUTHENTICATED_LOCAL_DEV=true only for an isolated local sandbox."
    )
if not INTERNAL_API_TOKEN:
    logger.warning(
        "The ML service is running without authentication because "
        "ALLOW_UNAUTHENTICATED_LOCAL_DEV=true. Never enable this in a shared environment."
    )


def verify_internal_token(x_internal_token: Optional[str] = Header(default=None)):
    """Reject requests that do not present the shared internal token."""
    if not INTERNAL_API_TOKEN and ALLOW_UNAUTHENTICATED_LOCAL_DEV:
        return
    if not x_internal_token or not secrets.compare_digest(
        x_internal_token, str(INTERNAL_API_TOKEN)
    ):
        raise HTTPException(status_code=401, detail="Unauthorized: invalid internal token")


class PredictionRequest(BaseModel):
    """Validated inference payload accepted from the authenticated BFF."""

    model_config = ConfigDict(extra="forbid")

    caption: str = Field(max_length=2200)
    format: Literal["Reels", "Carousel", "Single Image"]
    # A draft may not have a committed posting time yet. Unknown time is not
    # silently replaced with an arbitrary default; inference averages a fixed,
    # documented scenario set and marks the result provisional.
    post_hour: Optional[int] = Field(default=None, strict=True, ge=0, le=23)
    brand_id: Optional[str] = Field(default=None, max_length=36)
    niche: Optional[str] = Field(default=None, max_length=120)
    scheduled_date: str = Field(max_length=10)  # ISO date (YYYY-MM-DD)
    created_by: Optional[str] = Field(default=None, max_length=36)
    supersedes_prediction_id: Optional[str] = Field(default=None, max_length=36)
    supersession_reason: Optional[Literal[
        "inputs_changed", "time_finalized", "manual_rerun"
    ]] = None

    @field_validator("caption")
    @classmethod
    def caption_must_contain_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("caption must contain non-whitespace text")
        return value

    @model_validator(mode="after")
    def supersession_fields_are_coherent(self):
        has_parent = self.supersedes_prediction_id is not None
        has_reason = self.supersession_reason is not None
        if has_parent != has_reason:
            raise ValueError(
                "supersedes_prediction_id and supersession_reason must be supplied together"
            )
        if has_parent and (not self.brand_id or not self.created_by):
            raise ValueError("supersession requires brand_id and created_by")
        return self

class TrainRequest(BaseModel):
    """Validated model scope accepted from the authenticated BFF."""

    model_config = ConfigDict(extra="forbid")

    brand_id: Optional[str] = Field(default=None, max_length=36)
    niche: Optional[str] = Field(default=None, max_length=120)

    @model_validator(mode="after")
    def scope_is_valid(self):
        if not self.brand_id and not self.niche:
            raise ValueError("brand_id or niche is required")
        if self.brand_id:
            try:
                uuid.UUID(self.brand_id)
            except ValueError as exc:
                raise ValueError("brand_id must be a valid UUID") from exc
        if self.niche is not None and not self.niche.strip():
            raise ValueError("niche must contain non-whitespace text")
        return self

class InstagramPostInsightsRequest(BaseModel):
    """Tenant-scoped request for one media node owned by the linked account.

    The caption is deliberately not accepted from the caller. Prediction
    matching uses the caption returned by Meta for the verified media ID so a
    client cannot manufacture a relationship between an Instagram post and a
    prediction.
    """

    model_config = ConfigDict(extra="forbid")

    brand_id: str = Field(pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")
    media_id: str = Field(min_length=1, max_length=64, pattern=r"^[0-9]+$")
    created_by: str = Field(pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")


class InstagramIdentityBindingError(ValueError):
    """Safe operational error for a persistent brand/account mismatch."""

# DB connection helper
def get_db_connection():
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise HTTPException(status_code=500, detail="Database URL not configured")
    return psycopg2.connect(db_url)
