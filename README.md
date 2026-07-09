# FAIV Predict — Performance OS for Creative Work

> AI-powered content performance prediction for creative agencies and SMB social media specialists.
> A minimalist SaaS dashboard for classifying post performance tiers, diagnosing weak signals, and optimizing post configurations before publishing.

![Status](https://img.shields.io/badge/status-full--stack-7c3aed) ![Stack](https://img.shields.io/badge/stack-Next.js_14_+_FastAPI_+_Supabase-000)

---

## 1. What it does

**FAIV Predict** helps creators and small brands classify the **performance tier** (`HIGH`, `AVERAGE`, `LOW`) of Instagram posts *before* publishing them.

* **Real-time predictive classifier** — hierarchical Random Forest models (shared **niche model** → dedicated **personal model** once a brand accumulates 200 historical posts).
* **Calibration workspace** — test format, posting time, caption length, hashtag density, and CTA presence to see what shapes the score.
* **Explainability** — Mean Decrease in Impurity (MDI) feature-importance charts straight from the trained model, plus deterministic Template Recommendation Engine (TRE) suggestions.

### What it is NOT
* 🚫 Not a generative AI copywriter (AI caption refinement is an optional, clearly-labeled Gemini helper).
* 🚫 Not a reach estimator — it outputs classification tiers and model confidence, never absolute metrics ("+15% reach" style claims are deliberately absent).

---

## 2. System Architecture

```
┌─────────────────┐    /api/* (BFF)     ┌──────────────────┐
│  Next.js (App)  │ ──────────────────> │ FastAPI (Engine) │
│  UI + BFF proxy │ <────────────────── │ scikit-learn RF  │
└─────────────────┘  X-Internal-Token   └──────────────────┘
         │ supabase-js                           │ psycopg2 + Storage API
         ▼                                       ▼
┌────────────────────────────────────────────────────────────┐
│ Supabase — Postgres (brands, posts, predictions, models,   │
│ model_retrain_jobs) · Auth · Storage bucket "models"       │
└────────────────────────────────────────────────────────────┘
```

* **Frontend**: Next.js 14 App Router, Tailwind CSS, TypeScript, framer-motion, Recharts.
* **BFF proxy**: Next.js route handlers under `frontend/app/api/*` are the only surface the browser talks to. They attach the Supabase session JWT and the `INTERNAL_API_TOKEN` shared secret before forwarding to the private FastAPI service.
* **Inference engine**: FastAPI hosting Random Forest classifiers per niche/brand. If no trained model exists it returns an honest `503` — there is no fabricated fallback model.
* **Storage & Auth**: Supabase Postgres for brands/posts/predictions/model metadata; Supabase Storage for trained `.joblib` bundles; Supabase Auth for login sessions.
* **Optional LLM**: Google Gemini powers the brand classifier (`/api/classify`) and caption refinement (`/api/refine-caption`). Both report themselves unavailable (`501`) when `LLM_API_KEY` is not configured.
* **Automation**: an n8n workflow (`n8n/workflow_sync_retrain.json`) calls `POST /sync/now` weekly to pull Instagram Graph API data and retrain models.

### BFF API surface

| Route | Purpose |
| --- | --- |
| `POST /api/predict` | Validate input, proxy to FastAPI `/predict`, persist the prediction |
| `POST /api/suggest` | Proxy to FastAPI `/suggest` — deterministic TRE recommendations |
| `POST /api/refine-caption` | Optional Gemini caption rewrite (501 without `LLM_API_KEY`) |
| `POST /api/classify` | Optional Gemini niche classification (501 without `LLM_API_KEY`) |
| `GET/POST /api/brands` | Brands with real per-brand post counts (`samples`) |
| `GET/PATCH/DELETE /api/history` | Prediction log: list, reschedule/edit, delete |
| `GET /api/dashboard` | Workspace KPI aggregates (503 on database failure) |
| `GET /api/models` | Trained model registry |
| `GET/POST /api/train` | Trigger retraining and poll job status |

---

## 3. Machine Learning Pipeline

1. **Data**: historical posts per brand synced from the Instagram Graph API (`POST /sync`), stored with engagement rate (ER) and extracted features.
2. **Features (7)**: `is_single_image`, `is_carousel`, `is_reels`, `post_hour`, `caption_length`, `hashtag_count`, `has_cta`.
3. **Labeling**: ER percentiles (P33/P67) computed **on the training split only** (no leakage) map posts to `LOW / AVERAGE / HIGH`.
4. **Model**: `RandomForestClassifier(n_estimators=100, max_depth=4, min_samples_leaf=5)` — regularized for small datasets. Training requires ≥ 30 real posts and at least two distinct classes; otherwise it refuses with a clear error.
5. **Evaluation**: accuracy, weighted precision/recall/F1 on a held-out 20% split, stored in the `models.metrics` JSONB column.
6. **Serving**: model bundles (`model + thresholds + feature order`) uploaded to Supabase Storage, registered in the `models` table, downloaded and memory-cached by the inference service.
7. **Hierarchy**: prediction requests resolve a brand-specific (`account`) model first, falling back to the shared niche model. The response reports which one served the request (`is_personal_model_active`).
8. **Explainability**: real MDI feature importances are returned with every prediction and drive the Diagnose step's chart and "Why this score" panel.

---

## 4. Product Flow

The core flow lives on **`/predict`** as four connected steps with a persistent stepper ([FlowStepper.tsx](./frontend/components/FlowStepper.tsx)):

```
Predict (compose) → Result (tier + confidence + probabilities)
                  → Diagnose (MDI + signal review) → Optimize (TRE) → re-analyze
```

* **Predict** — pick the brand, format (`Reels` / `Carousel` / `Single Image`), schedule, and caption. Live caption intelligence (length, hashtags, CTA detection) updates as you type.
* **Result** — tier badge, confidence dial, and the full class-probability distribution.
* **Diagnose** — the model's MDI feature importances plus a signal review of your inputs against niche baselines.
* **Optimize** — deterministic TRE recommendations from the ML service; actionable ones can be staged and applied for one-click re-analysis.

Other pages:

* **`/dashboard`** — KPIs, model accuracy trend, recent forecasts, per-brand model status (all queried live from Supabase).
* **`/calendar`** — every prediction on its scheduled date. Drag to reschedule (persists), CSV batch import (each row is scored by the real model), CSV export.
* **`/history`** — filterable prediction log.
* **`/niches`** — brand registration with optional AI niche classification, real sample counts, and per-niche model status.
* **`/model-health`** — trained model registry with validation accuracy and manual retrain trigger (job status polled from the real retrain queue).

---

## 5. Getting Started

### Prerequisites
`Node.js 18+`, `Python 3.10+`, and a Supabase project (run [supabase_schema.sql](./supabase_schema.sql) in its SQL editor).

### Environment
Copy `.env.example` values into `frontend/.env.local` and `ml-service/.env` (see the file for details). Notes:

* `DATABASE_URL` must be a Postgres DSN, **not** the project `https://` URL.
* `SUPABASE_KEY` (ML service) should be the service-role key so model artifacts can be uploaded to Storage.
* `INTERNAL_API_TOKEN` must match between the frontend and the ML service; it is required in production.

### Run
```bash
# ML service
cd ml-service
python3 -m venv venv && ./venv/bin/pip install -r requirements.txt
./venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000

# Frontend
cd frontend
npm install
npm run dev
```
Open [http://localhost:3000](http://localhost:3000). Or run both with `docker compose up`.

### Tests
```bash
cd ml-service && ./venv/bin/python -m pytest   # ML service API tests
cd frontend && npm run lint && npx tsc --noEmit
```

---

*Last Updated: 2026-07-09*
