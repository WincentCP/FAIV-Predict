import re
from typing import Dict, Any, List, Tuple
import pandas as pd
import numpy as np

# Dictionary of Call-To-Action (CTA) Indonesian & English keywords
CTA_PATTERN = re.compile(
    r"\b(beli|dapatkan|pesan|kunjungi|klik|daftar|hubungi|contact|order|yuk|promo|diskon|check|checkout|tonton|baca|share|follow)\b",
    re.IGNORECASE
)

# Hashtag pattern
HASHTAG_PATTERN = re.compile(r"#\w+")

# Emoji ranges (BMP symbols + supplementary emoji planes)
EMOJI_PATTERN = re.compile(
    "[\U0001F300-\U0001F5FF\U0001F600-\U0001F64F\U0001F680-\U0001F6FF"
    "\U0001F900-\U0001F9FF\U0001FA70-\U0001FAFF☀-➿⬀-⯿️]"
)

# Feature vector orders. V1 is the 7-feature layout of pre-v2 model
# artifacts; every trained bundle stores its own order in bundle["features"],
# which always wins at inference time.
FEATURE_ORDER_V1 = [
    "is_single_image", "is_carousel", "is_reels",
    "post_hour", "caption_length", "hashtag_count", "has_cta",
]
FEATURE_ORDER_V2 = FEATURE_ORDER_V1 + ["is_weekend", "has_question", "emoji_count"]
NUMERIC_RANGE_FEATURES = ["post_hour", "caption_length", "hashtag_count", "emoji_count"]

class DataPreprocessor:
    """
    DataPreprocessor handles the feature extraction from social media posts
    and the percentile-based labeling for performance classification.
    """
    
    @staticmethod
    def extract_features(
        caption: str, format_type: str, post_hour: int, is_weekend: "bool | None" = None
    ) -> Dict[str, float]:
        """
        Extracts 10 numerical/boolean features from a post's content and metadata.

        Features (FEATURE_ORDER_V2):
        1. is_single_image (0.0/1.0)     6. hashtag_count
        2. is_carousel (0.0/1.0)         7. has_cta (0.0/1.0)
        3. is_reels (0.0/1.0)            8. is_weekend (0.0/1.0; None -> 0.0)
        4. post_hour (0.0 - 23.0)        9. has_question (0.0/1.0)
        5. caption_length               10. emoji_count
        """
        caption = caption or ""
        format_type = format_type or ""

        # 1. Format encoding (One-Hot)
        is_single_image = 1.0 if format_type == "Single Image" else 0.0
        is_carousel = 1.0 if format_type == "Carousel" else 0.0
        is_reels = 1.0 if format_type == "Reels" else 0.0

        # 2. Text features
        caption_length = float(len(caption))
        hashtag_count = float(len(HASHTAG_PATTERN.findall(caption)))
        has_cta = 1.0 if bool(CTA_PATTERN.search(caption)) else 0.0

        return {
            "is_single_image": is_single_image,
            "is_carousel": is_carousel,
            "is_reels": is_reels,
            "post_hour": float(post_hour),
            "caption_length": caption_length,
            "hashtag_count": hashtag_count,
            "has_cta": has_cta,
            "is_weekend": 1.0 if is_weekend else 0.0,
            "has_question": 1.0 if "?" in caption else 0.0,
            "emoji_count": float(len(EMOJI_PATTERN.findall(caption))),
        }

    @staticmethod
    def features_to_list(
        features: Dict[str, float], feature_order: "List[str] | None" = None
    ) -> List[float]:
        """
        Converts the features dict into an ordered vector. The order MUST come
        from the model bundle's own stored feature list so that old 7-feature
        artifacts keep receiving exactly the layout they were trained on.
        """
        order = feature_order or FEATURE_ORDER_V2
        return [float(features.get(name, 0.0)) for name in order]

    @staticmethod
    def compute_feature_ranges(X_train: pd.DataFrame) -> Dict[str, List[float]]:
        """Return train-split min/max bounds for numeric OOD checks."""
        return {
            col: [float(X_train[col].min()), float(X_train[col].max())]
            for col in NUMERIC_RANGE_FEATURES
            if col in X_train.columns
        }

    @staticmethod
    def out_of_range_features(
        features: Dict[str, float], ranges: "Dict[str, List[float]] | None"
    ) -> List[str]:
        """List inputs outside the model's train-split bounds.

        Older bundles do not contain ranges, so a missing or empty mapping is
        intentionally treated as no OOD information rather than an error.
        """
        if not ranges:
            return []
        return [
            name
            for name, bounds in ranges.items()
            if name in features
            and len(bounds) == 2
            and not (float(bounds[0]) <= float(features[name]) <= float(bounds[1]))
        ]

    @classmethod
    def process_dataframe(cls, df: pd.DataFrame) -> Tuple[pd.DataFrame, List[str]]:
        """
        Processes a raw DataFrame of historical posts, extracting the 7 standard features.
        Expects columns: 'caption', 'is_single_image', 'is_carousel', 'is_reels', 'post_hour'.
        If text columns caption_length, hashtag_count, has_cta are already computed, they will be used;
        otherwise they will be extracted from 'caption'.
        """
        processed_data = []
        for _, row in df.iterrows():
            caption = row.get("caption") or ""
            
            # Use raw values or extract
            is_single_image = 1.0 if row.get("is_single_image", False) else 0.0
            is_carousel = 1.0 if row.get("is_carousel", False) else 0.0
            is_reels = 1.0 if row.get("is_reels", False) else 0.0
            
            post_hour = float(row.get("post_hour", 0))
            
            # Text extraction
            caption_length = float(row.get("caption_length") if "caption_length" in row and not pd.isna(row["caption_length"]) else len(caption))
            hashtag_count = float(row.get("hashtag_count") if "hashtag_count" in row and not pd.isna(row["hashtag_count"]) else len(HASHTAG_PATTERN.findall(caption)))
            
            if "has_cta" in row and not pd.isna(row["has_cta"]):
                has_cta = 1.0 if row["has_cta"] else 0.0
            else:
                has_cta = 1.0 if bool(CTA_PATTERN.search(caption)) else 0.0

            # is_weekend from the post's timestamp, shifted UTC -> WIB (+7h)
            # to match the post_hour semantics used by the sync pipeline.
            is_weekend = 0.0
            if "created_at" in row and not pd.isna(row["created_at"]):
                try:
                    ts = pd.to_datetime(row["created_at"], utc=True) + pd.Timedelta(hours=7)
                    is_weekend = 1.0 if ts.dayofweek >= 5 else 0.0
                except (ValueError, TypeError):
                    is_weekend = 0.0

            processed_data.append({
                "is_single_image": is_single_image,
                "is_carousel": is_carousel,
                "is_reels": is_reels,
                "post_hour": post_hour,
                "caption_length": caption_length,
                "hashtag_count": hashtag_count,
                "has_cta": has_cta,
                "is_weekend": is_weekend,
                "has_question": 1.0 if "?" in caption else 0.0,
                "emoji_count": float(len(EMOJI_PATTERN.findall(caption))),
            })

        feature_cols = list(FEATURE_ORDER_V2)
        return pd.DataFrame(processed_data)[feature_cols], feature_cols

    @staticmethod
    def calculate_percentile_bounds(er_series: pd.Series) -> Tuple[float, float]:
        """
        Calculates the 33rd and 67th percentiles on a series of Engagement Rates.
        To avoid data leakage, this should ONLY be run on the training split of the dataset.
        """
        p33 = float(np.percentile(er_series, 33))
        p67 = float(np.percentile(er_series, 67))
        return p33, p67

    @staticmethod
    def label_performance(er: float, p33: float, p67: float) -> str:
        """
        Categorizes an Engagement Rate (er) relative to percentile thresholds:
        - LOW: er < p33
        - AVERAGE: p33 <= er <= p67
        - HIGH: er > p67
        """
        if er < p33:
            return "LOW"
        elif er <= p67:
            return "AVERAGE"
        else:
            return "HIGH"

