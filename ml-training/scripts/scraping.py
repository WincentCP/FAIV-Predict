"""
==============================================================
  Scraping Ulasan Aplikasi Shopee dari Google Play Store
  Platform  : Google Play Store
  Target    : Ulasan aplikasi Shopee (com.shopee.id)
  Bahasa    : Indonesia
  Output    : shopee_reviews.csv
==============================================================
"""

import pandas as pd
import time
import os
from google_play_scraper import reviews, Sort
from datetime import datetime

# ──────────────────────────────────────────────
# KONFIGURASI
# ──────────────────────────────────────────────
APP_ID        = "com.shopee.id"          # Package ID aplikasi Shopee Indonesia
LANG          = "id"                     # Bahasa Indonesia
COUNTRY       = "id"                     # Negara Indonesia
TARGET_COUNT  = 10_000                   # Target jumlah ulasan
BATCH_SIZE    = 200                      # Jumlah ulasan per request
OUTPUT_FILE   = "shopee_reviews.csv"     # Nama file output


def scrape_reviews(app_id: str, target: int, batch: int) -> pd.DataFrame:
    """
    Scrape ulasan dari Google Play Store menggunakan google-play-scraper.
    
    Args:
        app_id  : Package ID aplikasi
        target  : Jumlah ulasan yang ingin dikumpulkan
        batch   : Jumlah ulasan per batch request
    
    Returns:
        DataFrame berisi ulasan yang sudah dibersihkan
    """
    all_reviews = []
    token       = None
    iteration   = 0

    print(f"[INFO] Mulai scraping ulasan '{app_id}'")
    print(f"[INFO] Target: {target:,} ulasan\n")

    while len(all_reviews) < target:
        try:
            result, token = reviews(
                app_id,
                lang        = LANG,
                country     = COUNTRY,
                sort        = Sort.NEWEST,
                count       = batch,
                continuation_token = token
            )

            if not result:
                print("[WARN] Tidak ada data lagi dari server. Scraping dihentikan.")
                break

            all_reviews.extend(result)
            iteration += 1

            print(
                f"  Batch {iteration:>3} | "
                f"Terkumpul: {len(all_reviews):>6,} ulasan | "
                f"Token: {'ada' if token else 'habis'}"
            )

            # Jika tidak ada token lanjutan, hentikan
            if token is None:
                print("[INFO] Tidak ada halaman berikutnya.")
                break

            # Jeda agar tidak dianggap spam
            time.sleep(1.5)

        except Exception as e:
            print(f"[ERROR] Terjadi kesalahan pada batch {iteration + 1}: {e}")
            print("[INFO] Menunggu 5 detik sebelum mencoba lagi...")
            time.sleep(5)
            # Jika error berulang, hentikan
            iteration += 1
            if iteration > 100:
                break

    print(f"\n[INFO] Total ulasan terkumpul: {len(all_reviews):,}")
    return all_reviews


def parse_reviews(raw_reviews: list) -> pd.DataFrame:
    """
    Mengurai dan membersihkan data ulasan mentah menjadi DataFrame.
    
    Args:
        raw_reviews : List dict hasil scraping
    
    Returns:
        DataFrame bersih siap disimpan
    """
    records = []
    for r in raw_reviews:
        records.append({
            "review_id"    : r.get("reviewId", ""),
            "username"     : r.get("userName", ""),
            "rating"       : r.get("score", None),          # Bintang 1–5
            "ulasan"       : r.get("content", ""),
            "tanggal"      : r.get("at", None),
            "thumbs_up"    : r.get("thumbsUpCount", 0),
            "versi_app"    : r.get("reviewCreatedVersion", ""),
        })

    df = pd.DataFrame(records)

    # ── Bersihkan data ────────────────────────────────────
    # Hapus ulasan kosong
    df = df[df["ulasan"].notna() & (df["ulasan"].str.strip() != "")]

    # Hapus duplikat berdasarkan review_id dan isi ulasan
    df = df.drop_duplicates(subset=["review_id"])
    df = df.drop_duplicates(subset=["ulasan"])

    # Reset index
    df = df.reset_index(drop=True)

    return df


def assign_sentiment_label(df: pd.DataFrame) -> pd.DataFrame:
    """
    Memberikan label sentimen berdasarkan rating bintang:
      ★★★★★ (4–5) → Positif
      ★★★   (3)   → Netral
      ★★    (1–2) → Negatif
    
    Aturan ini umum digunakan dalam penelitian analisis sentimen
    berbasis rating (lexicon-based labeling via rating proxy).
    
    Args:
        df : DataFrame dengan kolom 'rating'
    
    Returns:
        DataFrame dengan tambahan kolom 'sentimen' dan 'label'
    """
    def map_label(rating):
        if rating >= 4:
            return "positif"
        elif rating == 3:
            return "netral"
        else:
            return "negatif"

    def map_label_num(rating):
        if rating >= 4:
            return 2
        elif rating == 3:
            return 1
        else:
            return 0

    df["sentimen"] = df["rating"].apply(map_label)
    df["label"]    = df["rating"].apply(map_label_num)  # 0=negatif, 1=netral, 2=positif

    return df


def print_summary(df: pd.DataFrame) -> None:
    """Cetak ringkasan statistik dataset."""
    print("\n" + "="*50)
    print("  RINGKASAN DATASET")
    print("="*50)
    print(f"  Total ulasan   : {len(df):,}")
    print(f"  Kolom          : {list(df.columns)}")
    print(f"\n  Distribusi Sentimen:")
    dist = df["sentimen"].value_counts()
    for label, count in dist.items():
        pct = count / len(df) * 100
        print(f"    {label:<10}: {count:>6,}  ({pct:.1f}%)")
    print(f"\n  Distribusi Rating:")
    for star in sorted(df["rating"].unique()):
        count = (df["rating"] == star).sum()
        print(f"    {star} bintang : {count:>6,}")
    print("="*50)


def main():
    # 1. Scraping
    raw = scrape_reviews(APP_ID, TARGET_COUNT, BATCH_SIZE)

    if not raw:
        print("[ERROR] Tidak ada data yang berhasil di-scrape. Cek koneksi internet.")
        return

    # 2. Parse & bersihkan
    df = parse_reviews(raw)
    print(f"[INFO] Setelah dibersihkan: {len(df):,} ulasan unik")

    # 3. Labeling sentimen
    df = assign_sentiment_label(df)

    # 4. Tampilkan ringkasan
    print_summary(df)

    # 5. Simpan ke CSV
    df.to_csv(OUTPUT_FILE, index=False, encoding="utf-8-sig")
    print(f"\n[✓] Dataset berhasil disimpan: '{OUTPUT_FILE}'")
    print(f"[✓] Scraping selesai pada: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    # 6. Preview 5 baris pertama
    print("\n[INFO] Preview data:")
    print(df[["rating", "sentimen", "ulasan"]].head())


if __name__ == "__main__":
    main()
