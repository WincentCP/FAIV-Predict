-- DDL SQL Supabase PostgreSQL untuk 5 Tabel Sistem FAIV Predict

-- Enable UUID extension if not enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Tabel brands
CREATE TABLE IF NOT EXISTS brands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    niche VARCHAR(255) NOT NULL,
    followers INTEGER DEFAULT 0,
    model_type VARCHAR(50) DEFAULT 'niche' NOT NULL, -- 'niche' atau 'personal'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Tabel posts
CREATE TABLE IF NOT EXISTS posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID REFERENCES brands(id) ON DELETE CASCADE NOT NULL,
    caption TEXT,
    er NUMERIC NOT NULL,
    is_synced BOOLEAN DEFAULT false NOT NULL,
    follower_count_at_post INTEGER NOT NULL,
    is_single_image BOOLEAN DEFAULT false NOT NULL,
    is_carousel BOOLEAN DEFAULT false NOT NULL,
    is_reels BOOLEAN DEFAULT false NOT NULL,
    post_hour INTEGER NOT NULL,
    caption_length INTEGER NOT NULL,
    hashtag_count INTEGER NOT NULL,
    has_cta BOOLEAN DEFAULT false NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Tabel predictions
CREATE TABLE IF NOT EXISTS predictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID REFERENCES brands(id) ON DELETE CASCADE NOT NULL,
    title VARCHAR(255) NOT NULL,
    caption TEXT,
    features JSONB NOT NULL, -- Menyimpan parameter input prediction
    pred_class VARCHAR(50) NOT NULL, -- 'HIGH', 'AVERAGE', 'LOW'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    scheduled_date DATE
);

-- 4. Tabel models
CREATE TABLE IF NOT EXISTS models (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID REFERENCES brands(id) ON DELETE CASCADE, -- NULL jika model shared-niche
    niche VARCHAR(255),                                    -- NULL jika model personal brand
    model_type VARCHAR(50) NOT NULL,                       -- 'niche' atau 'account'
    storage_path VARCHAR(500) NOT NULL,                    -- Path lokal/Supabase Storage bucket
    storage_url VARCHAR(500),                              -- URL publik untuk unduhan
    version VARCHAR(50) NOT NULL,
    accuracy NUMERIC,                                      -- Akurasi evaluasi model
    metrics JSONB NOT NULL,                                -- Evaluasi lengkap (Precision, Recall, F1-Score)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Tabel model_retrain_jobs
CREATE TABLE IF NOT EXISTS model_retrain_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID REFERENCES brands(id) ON DELETE CASCADE,
    status VARCHAR(50) DEFAULT 'pending' NOT NULL,         -- 'pending', 'running', 'success', 'failed'
    error_message TEXT,                                    -- Keterangan galat jika gagal
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE,
    finished_at TIMESTAMP WITH TIME ZONE                   -- Kompatibilitas alias untuk completed_at
);

-- Create Indexes for optimization
CREATE INDEX IF NOT EXISTS idx_posts_brand_id ON posts(brand_id);
CREATE INDEX IF NOT EXISTS idx_predictions_brand_id ON predictions(brand_id);
CREATE INDEX IF NOT EXISTS idx_models_brand_id ON models(brand_id);
CREATE INDEX IF NOT EXISTS idx_models_niche ON models(niche);
CREATE INDEX IF NOT EXISTS idx_model_retrain_jobs_brand_id ON model_retrain_jobs(brand_id);
