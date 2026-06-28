"""
==============================================================================
  FAIV Predict — Instagram Public Profile Scraper for Thesis Model Training
  Platform  : Instagram (Public Profiles)
  Library   : instaloader
  Output    : instagram_posts_dataset.csv (Tailored to PostgreSQL posts schema)
==============================================================================
"""

import os
import re
import time
import datetime
import pandas as pd
import instaloader

# ─────────────────────────────────────────────────────────────────────────────
# CONFIGURATION
# ─────────────────────────────────────────────────────────────────────────────
# List of public Instagram handles representing different niches for training
TARGET_ACCOUNTS = [
  "lasence.bakeshop",  # F&B / Bakery
  "bisongym.mdn",      # Fitness / Gym
  "nova.studio",       # Creative Agency
  "solene.atelier"     # Fashion
]

POSTS_PER_ACCOUNT = 150  # Number of historical posts to retrieve per account
OUTPUT_FILE = "instagram_posts_dataset.csv"

# Regex CTA Keywords defined in implementation guide
CTA_WORDS_REGEX = r"(beli|dapatkan|pesan|kunjungi|klik|daftar|hubungi|contact|order|yuk|promo|diskon|check|checkout|tonton|baca|share|follow)"


def calculate_er(likes: int, comments: int, followers: int) -> float:
  """Calculates Engagement Rate (ER) based on likes, comments, and followers."""
  if not followers or followers <= 0:
    return 0.0
  return round(((likes + comments) / followers) * 100, 4)


def scrape_instagram_dataset():
  loader = instaloader.Instaloader()
  
  # Optional: loader.login("your_username", "your_password")
  # Note: Scrapers running without authentication may be rate-limited faster.
  
  dataset = []
  
  print("[INFO] Initializing Instagram Scraper...")
  print(f"[INFO] Target Accounts: {TARGET_ACCOUNTS}")
  print(f"[INFO] Posts per account: {POSTS_PER_ACCOUNT}\n")
  
  for handle in TARGET_ACCOUNTS:
    print(f"==================================================")
    print(f"[PROCESS] Accessing profile: @{handle}...")
    try:
      profile = instaloader.Profile.from_username(loader.context, handle)
      followers = profile.followers
      print(f"[INFO] Followers count: {followers:,}")
      
      count = 0
      for post in profile.get_posts():
        if count >= POSTS_PER_ACCOUNT:
          break
          
        # Extract timestamp details
        post_time = post.date_utc
        post_hour = post.date_utc.hour
        
        # Determine media format
        is_video = post.is_video
        typename = post.typename  # 'GraphImage', 'GraphSidecar', 'GraphVideo'
        
        is_single_image = False
        is_carousel = False
        is_reels = False
        
        if typename == "GraphImage":
          is_single_image = True
        elif typename == "GraphSidecar":
          is_carousel = True
        elif typename == "GraphVideo" or is_video:
          is_reels = True
        else:
          is_single_image = True  # fallback default
          
        caption = post.caption if post.caption else ""
        likes = post.likes
        comments = post.comments
        
        # Compute ER
        er = calculate_er(likes, comments, followers)
        
        # Preprocess features
        caption_length = len(caption)
        hashtag_count = len(re.findall(r'#\w+', caption))
        has_cta = True if re.search(CTA_WORDS_REGEX, caption.lower()) else False
        
        dataset.append({
          "brand_handle": handle,
          "caption": caption,
          "er": er,
          "follower_count_at_post": followers,
          "is_single_image": is_single_image,
          "is_carousel": is_carousel,
          "is_reels": is_reels,
          "post_hour": post_hour,
          "caption_length": caption_length,
          "hashtag_count": hashtag_count,
          "has_cta": has_cta,
          "likes": likes,
          "comments": comments,
          "created_at": post_time.isoformat()
        })
        
        count += 1
        if count % 10 == 0:
          print(f"  Processed {count}/{POSTS_PER_ACCOUNT} posts...")
          
        # Sleep to comply with request rate limit boundaries
        time.sleep(1.0)
        
    except Exception as e:
      print(f"[ERROR] Failed to scrape @{handle}: {e}")
      print("[INFO] Moving to next handle...")
      
  if dataset:
    df = pd.DataFrame(dataset)
    df.to_csv(OUTPUT_FILE, index=False)
    print(f"\n[SUCCESS] Scraped {len(df)} total posts. Saved to: {OUTPUT_FILE}")
  else:
    print("\n[WARN] No posts were collected.")


if __name__ == "__main__":
  scrape_instagram_dataset()
