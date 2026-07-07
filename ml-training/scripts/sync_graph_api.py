"""
==============================================================================
  FAIV Predict — Instagram Graph API Sync Script for Thesis Model Training
  Queries live Instagram Business Accounts (Bison Gym & Lasence Bakeshop),
  calculates Engagement Rates, processes features, and inserts into Supabase.
  
  [NOTE: DEPRECATED IN PRODUCTION]
  This script is retained for offline/manual utility testing.
  Production sync & retrain is handled programmatically via n8n calling
  the FastAPI /sync endpoints in ml-service/app/main.py.
==============================================================================
"""

import os
import re
import datetime
import httpx
import psycopg2
from psycopg2.extras import RealDictCursor

# ─────────────────────────────────────────────────────────────────────────────
# ENVIRONMENT LOADER
# ─────────────────────────────────────────────────────────────────────────────
def load_env_manually():
    """Manually parse .env file to avoid dependencies issues."""
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    env_path = os.path.join(base_dir, "ml-service", ".env")
    if os.path.exists(env_path):
        print(f"[INFO] Loading configurations from {env_path}...")
        with open(env_path, "r") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    parts = line.split("=", 1)
                    if len(parts) == 2:
                        key = parts[0].strip()
                        val = parts[1].strip()
                        # Strip optional quotes
                        if val.startswith('"') and val.endswith('"'):
                            val = val[1:-1]
                        elif val.startswith("'") and val.endswith("'"):
                            val = val[1:-1]
                        os.environ[key] = val
    else:
        print(f"[WARN] Environment file not found at {env_path}")

load_env_manually()

# Regex CTA Keywords defined in implementation guide
CTA_WORDS_REGEX = re.compile(
    r"\b(beli|dapatkan|pesan|kunjungi|klik|daftar|hubungi|contact|order|yuk|promo|diskon|check|checkout|tonton|baca|share|follow)\b",
    re.IGNORECASE
)
HASHTAG_PATTERN = re.compile(r"#\w+")

def get_db_connection():
    db_url = os.getenv("DATABASE_URL")
    if not db_url or "[YOUR-DB-PASSWORD]" in db_url:
        raise ValueError("DATABASE_URL is not set or contains placeholders. Please update ml-service/.env first.")
    return psycopg2.connect(db_url)

def fetch_instagram_info(instagram_id: str, access_token: str) -> int:
    """Fetch Instagram profile follower count."""
    url = f"https://graph.facebook.com/v25.0/{instagram_id}"
    params = {
        "fields": "followers_count",
        "access_token": access_token
    }
    print(f"[API] Fetching profile info for account: {instagram_id}...")
    with httpx.Client(timeout=15.0) as client:
        r = client.get(url, params=params)
        r.raise_for_status()
        data = r.json()
        return data.get("followers_count", 0)

def fetch_instagram_posts(instagram_id: str, access_token: str, limit: int = 150):
    """Fetch historical media posts from the Instagram account."""
    url = f"https://graph.facebook.com/v25.0/{instagram_id}/media"
    params = {
        "fields": "caption,like_count,comments_count,media_type,timestamp,permalink",
        "limit": limit,
        "access_token": access_token
    }
    print(f"[API] Fetching historical posts for account {instagram_id} (limit={limit})...")
    posts_data = []
    
    with httpx.Client(timeout=30.0) as client:
        while url and len(posts_data) < limit:
            r = client.get(url, params=params)
            r.raise_for_status()
            res = r.json()
            
            data = res.get("data", [])
            posts_data.extend(data)
            
            # Check pagination
            paging = res.get("paging", {})
            url = paging.get("next")
            params = {} # params are already encoded in the next url
            
            if not data or not url:
                break
                
    return posts_data[:limit]

def calculate_er(likes: int, comments: int, followers: int) -> float:
    if not followers or followers <= 0:
        return 0.0
    return round(((likes + comments) / followers) * 100, 4)

def parse_media_format(media_type: str):
    """Maps Meta Graph media types to binary schema options."""
    # GRAPH API Media types: IMAGE, VIDEO, CAROUSEL_ALBUM
    is_single_image = False
    is_carousel = False
    is_reels = False
    
    if media_type == "IMAGE":
        is_single_image = True
    elif media_type == "CAROUSEL_ALBUM":
        is_carousel = True
    elif media_type == "VIDEO":
        is_reels = True
    else:
        is_single_image = True # Default fallback
        
    return is_single_image, is_carousel, is_reels

def convert_to_local_hour(timestamp_str: str) -> int:
    """Parses ISO timestamp from Meta and adjusts to local Jakarta time (UTC+7)."""
    # Meta returns UTC ISO strings (e.g. '2026-07-01T12:00:00+0000' or '2026-07-01T12:00:00Z')
    clean_ts = timestamp_str.replace("Z", "+00:00").replace("+0000", "+00:00")
    dt_utc = datetime.datetime.fromisoformat(clean_ts)
    # Convert to Jakarta time
    dt_local = dt_utc + datetime.timedelta(hours=7)
    return dt_local.hour

def sync_brand(name: str, niche: str, ig_id: str, token: str):
    print(f"\n==================================================")
    print(f"[PROCESS] Syncing brand: {name} (Niche: {niche})")
    print(f"==================================================")
    
    # 1. Fetch live followers
    try:
        followers = fetch_instagram_info(ig_id, token)
        print(f"[SUCCESS] Followers count for {name}: {followers:,}")
    except Exception as e:
        print(f"[ERROR] Failed to fetch Instagram profile details: {e}")
        return
        
    # 2. Register/Update Brand in DB
    conn = get_db_connection()
    brand_id = None
    try:
        with conn.cursor() as cur:
            # Check if brand exists
            cur.execute("SELECT id FROM brands WHERE name = %s", (name,))
            row = cur.fetchone()
            if row:
                brand_id = row[0]
                cur.execute(
                    "UPDATE brands SET followers = %s, niche = %s WHERE id = %s",
                    (followers, niche, brand_id)
                )
                print(f"[DB] Updated existing brand record ID: {brand_id}")
            else:
                cur.execute(
                    "INSERT INTO brands (name, niche, followers, model_type) VALUES (%s, %s, %s, 'personal') RETURNING id",
                    (name, niche, followers)
                )
                brand_id = cur.fetchone()[0]
                print(f"[DB] Created new brand record ID: {brand_id}")
        conn.commit()
    except Exception as e:
        print(f"[ERROR] Database brand operation failed: {e}")
        conn.close()
        return

    # 3. Fetch live posts
    try:
        posts = fetch_instagram_posts(ig_id, token)
        print(f"[SUCCESS] Retrieved {len(posts)} posts from Meta API.")
    except Exception as e:
        print(f"[ERROR] Failed to fetch posts from Meta API: {e}")
        conn.close()
        return

    # 4. Save/Sync posts to DB
    try:
        with conn.cursor() as cur:
            # Delete old posts for a fresh dataset upload (prevents duplicated records on sync)
            cur.execute("DELETE FROM posts WHERE brand_id = %s", (brand_id,))
            print(f"[DB] Cleared old historical records for brand_id {brand_id} to prepare fresh import.")
            
            count = 0
            for post in posts:
                caption = post.get("caption", "")
                likes = post.get("like_count", 0)
                comments = post.get("comments_count", 0)
                media_type = post.get("media_type", "IMAGE")
                timestamp = post.get("timestamp")
                
                # Preprocess fields
                er = calculate_er(likes, comments, followers)
                is_single, is_carousel, is_reels = parse_media_format(media_type)
                post_hour = convert_to_local_hour(timestamp)
                caption_length = len(caption)
                hashtag_count = len(HASHTAG_PATTERN.findall(caption))
                has_cta = True if bool(CTA_WORDS_REGEX.search(caption)) else False
                
                cur.execute(
                    """
                    INSERT INTO posts (brand_id, caption, er, is_synced, follower_count_at_post, 
                                       is_single_image, is_carousel, is_reels, post_hour, 
                                       caption_length, hashtag_count, has_cta, created_at)
                    VALUES (%s, %s, %s, true, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        brand_id, caption, er, followers,
                        is_single, is_carousel, is_reels, post_hour,
                        caption_length, hashtag_count, has_cta, timestamp
                    )
                )
                count += 1
            
            print(f"[DB] Successfully inserted {count} processed posts into 'posts' table.")
        conn.commit()
    except Exception as e:
        print(f"[ERROR] Database posts operation failed: {e}")
    finally:
        conn.close()

def main():
    print("[START] Initializing Instagram Graph API Data Synchronizer...")
    
    brands_to_sync = []
    
    # Check configurations for Bison Gym
    bison_token = os.getenv("BISON_PAGE_ACCESS_TOKEN")
    bison_ig_id = os.getenv("BISON_INSTAGRAM_ID")
    if bison_token and bison_ig_id:
        brands_to_sync.append(("Bison Gym", "Fitness", bison_ig_id, bison_token))
    else:
        print("[WARN] Bison Gym configurations missing from environment variables.")

    # Check configurations for Lasence Bakeshop
    lasence_token = os.getenv("LASENCE_PAGE_ACCESS_TOKEN")
    lasence_ig_id = os.getenv("LASENCE_INSTAGRAM_ID")
    if lasence_token and lasence_ig_id:
        brands_to_sync.append(("Lasence Bakeshop", "Bakery", lasence_ig_id, lasence_token))
    else:
        print("[WARN] Lasence Bakeshop configurations missing from environment variables.")

    if not brands_to_sync:
        print("[ABORT] No brands configured for sync. Set variables in ml-service/.env first.")
        return
        
    for name, niche, ig_id, token in brands_to_sync:
        sync_brand(name, niche, ig_id, token)
        
    print("\n[COMPLETE] Sync job finished.")

if __name__ == "__main__":
    main()
