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

class DataPreprocessor:
    """
    DataPreprocessor handles the feature extraction from social media posts
    and the percentile-based labeling for performance classification.
    """
    
    @staticmethod
    def extract_features(caption: str, format_type: str, post_hour: int) -> Dict[str, float]:
        """
        Extracts 7 numerical/boolean features from a post's content and metadata.
        
        Features:
        1. is_single_image (float: 0.0 or 1.0)
        2. is_carousel (float: 0.0 or 1.0)
        3. is_reels (float: 0.0 or 1.0)
        4. post_hour (float: 0.0 - 23.0)
        5. caption_length (float)
        6. hashtag_count (float)
        7. has_cta (float: 0.0 or 1.0)
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
            "has_cta": has_cta
        }

    @staticmethod
    def features_to_list(features: Dict[str, float]) -> List[float]:
        """
        Converts the features dictionary into an ordered list matching model expectations:
        [is_single_image, is_carousel, is_reels, post_hour, caption_length, hashtag_count, has_cta]
        """
        return [
            features["is_single_image"],
            features["is_carousel"],
            features["is_reels"],
            features["post_hour"],
            features["caption_length"],
            features["hashtag_count"],
            features["has_cta"]
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
            caption = row.get("caption", "")
            
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
                
            processed_data.append({
                "is_single_image": is_single_image,
                "is_carousel": is_carousel,
                "is_reels": is_reels,
                "post_hour": post_hour,
                "caption_length": caption_length,
                "hashtag_count": hashtag_count,
                "has_cta": has_cta
            })
            
        feature_cols = [
            "is_single_image", "is_carousel", "is_reels", 
            "post_hour", "caption_length", "hashtag_count", "has_cta"
        ]
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
