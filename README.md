# FAIV Predict — Performance OS for Creative Work

> AI-powered content performance prediction for creative agencies and SMB social media specialists.
> A minimalist SaaS dashboard for classifying post performance tiers, diagnosing weak signals, and optimizing post configurations before publishing.

![Status](https://img.shields.io/badge/status-full--stack-7c3aed) ![Stack](https://img.shields.io/badge/stack-Next.js_14_+_FastAPI_+_Supabase-000)

---

## 1. What it does

**FAIV Predict** helps creators and small brands classify the **performance tier** (`HIGH`, `AVERAGE`, `LOW`) of Instagram posts *before* publishing them.

* **Real-time predictive classifier** — hierarchical Random Forest models (shared **niche model** → dedicated **personal model** once a brand accumulates 200 historical posts).
* **Calibration workspace** — test format, posting time, caption length, hashtag density, and CTA presence to see what shapes the score.
* **Explainability** — global MDI feature-importance charts *and* per-draft counterfactual "what-if" analysis measured by the real model, distinguished from heuristic Template Recommendation Engine (TRE) guidance.

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
* **BFF proxy**: Next.js route handlers under `frontend/app/api/*` are the only surface the browser talks to. The Supabase middleware gates them behind a login session; they attach the `INTERNAL_API_TOKEN` shared secret before forwarding to the private FastAPI service.
* **Inference engine**: FastAPI hosting Random Forest classifiers per niche/brand. If no trained model exists it returns an honest `503` — there is no fabricated fallback model.
* **Storage & Auth**: Supabase Postgres for brands/posts/predictions/model metadata; Supabase Storage for trained `.joblib` bundles; Supabase Auth for login sessions.
* **Optional LLM**: Google Gemini powers the brand classifier (`/api/classify`) and caption refinement (`/api/refine-caption`). Both report themselves unavailable (`501`) when `LLM_API_KEY` is not configured.
* **Automation**: one n8n workflow (`n8n/workflow_sync_retrain.json`) with two schedules — a **weekly** run (Mon 06:00 WIB) that calls `POST /sync/now` to pull Instagram Graph API data and retrain models, and a **daily** run (07:00 WIB) that calls `GET /instagram/health` and emails a warning if any access token is broken. Both runs email their outcome. n8n needs `INTERNAL_API_TOKEN` in its environment (the HTTP nodes send it as `X-Internal-Token`).
* **Row-Level Security**: enabled on all tables with policies shipped in the schema — logged-in users share one workspace (read everything, register brands); anonymous keys read nothing; the ML service connects as the table owner and bypasses RLS.
* **CI**: GitHub Actions (`.github/workflows/ci.yml`) runs frontend lint + type-check + production build and the ML service test suite on every push and PR.

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
| `GET /api/instagram-health` | Live Instagram token validation + data freshness per linked brand |

---

## 3. Machine Learning Pipeline

1. **Data**: historical posts per brand synced from the Instagram Graph API (`POST /sync/now`), stored with engagement rate (ER) and extracted features.
2. **Features (10)**: `is_single_image`, `is_carousel`, `is_reels`, `post_hour`, `caption_length`, `hashtag_count`, `has_cta`, `is_weekend`, `has_question`, `emoji_count` — all derived from real stored posts. The model bundle stores its own feature order, so older 7-feature artifacts keep serving correctly after the feature set grows.
3. **Labeling**: ER percentiles (P33/P67) computed **on the training split only** (no leakage) map posts to `LOW / AVERAGE / HIGH`.
   The train/test split is **chronological (80:20)** — the model trains on older posts and is validated on the newest, mirroring production use and avoiding look-ahead leakage on time-ordered data.
4. **Model**: `RandomForestClassifier(n_estimators=100, max_depth=4, min_samples_leaf=5)` — regularized for small datasets. Training requires ≥ 30 real posts and at least two distinct classes; otherwise it refuses with a clear error.
5. **Evaluation**: accuracy, weighted precision/recall/F1 on a held-out 20% split, stored in the `models.metrics` JSONB column.
6. **Serving**: model bundles (`model + thresholds + feature order`) uploaded to Supabase Storage, registered in the `models` table, downloaded and memory-cached by the inference service.
7. **Hierarchy**: prediction requests resolve a brand-specific (`account`) model first, falling back to the shared niche model. The response reports which one served the request (`is_personal_model_active`).
8. **Explainability**: two complementary layers. **Global** — real MDI feature importances returned with every prediction drive the importance chart and "Why this score" signals. **Local (counterfactual / what-if)** — after predicting, the model re-scores ~6–8 single-feature variants of the *same* draft in one batched `predict_proba` call and returns the measured change in P(High) for each (e.g. "Switch format to Reels: 7% → 58%"). These are evidence, not heuristics; changes with no measured gain are reported honestly, and a model whose classes lack a High tier returns an explicit "unavailable" note rather than fabricated numbers.
9. **Outcome tracking**: each weekly sync matches published posts back to past predictions (normalized exact-caption match per brand), recording the realized engagement rate and tier (`actual_er` / `actual_class`, graded with the same percentile method as training labels). The History page shows Predicted vs Actual side by side; drafts edited before publishing stay honestly "Pending" rather than guessed.

---

## 4. Product Flow

The core flow lives on **`/predict`** as two focused views:

```
Compose (draft the post) → Insights (everything the model has to say, one screen)
```

* **Compose** — one column: a compact setup strip (brand + format + schedule), the caption as the hero input with live signals (length, hashtags, CTA, question, emoji), and an optional collapsed **AI Assistant** (Gemini concept analysis + caption refinement — clearly labelled as *not* affecting the score).
* **Insights** — a single scrollable screen: the verdict (tier, confidence dial, class probabilities), a **Trust strip** stating exactly what the score is based on (personal vs niche model, training-set size, validated accuracy, model version), **Measured Improvements** (counterfactual what-if results ranked by measured effect), evidence (MDI chart + "Why this score"), and **Guideline Recommendations** (heuristic TRE, badged "Guideline" to distinguish them from measured evidence). Actionable changes stage for one-click Apply & Re-Analyze — the posting-hour change uses the *measured* best hour from the what-if analysis.

Other pages:

* **`/dashboard`** — KPIs, model accuracy trend, recent forecasts, per-brand model status (all queried live from Supabase).
* **`/calendar`** — every prediction on its scheduled date. Drag to reschedule (persists), CSV batch import (each row is scored by the real model), CSV export.
* **`/history`** — filterable prediction log.
* **`/niches`** — brand registration with optional AI niche classification, real sample counts, and per-niche model status.
* **`/model-health`** — trained model registry with validation accuracy and manual retrain trigger (job status polled from the real retrain queue), plus per-brand **Instagram connection cards**: live token status, follower count, and how fresh the synced data is. An expired token shows up here (and in the daily n8n warning email) before the weekly pipeline would fail on it.

---

## 5. Getting Started

### Prerequisites
`Node.js 18+`, `Python 3.10+`, and a Supabase project (run [supabase_schema.sql](./supabase_schema.sql) in its SQL editor).

### Environment
Copy `.env.example` values into `frontend/.env.local` and `ml-service/.env` (see the file for details). Notes:

* `DATABASE_URL` must be a Postgres DSN, **not** the project `https://` URL.
* `SUPABASE_KEY` (ML service) should be a secret/service-role key so model artifacts can be uploaded to Storage.
* `INTERNAL_API_TOKEN` must match between the frontend, the ML service, and n8n; it is required in production.
* `IG_BRANDS_JSON` (ML service, optional) links Instagram Business accounts for the sync pipeline — one JSON array, so onboarding a brand is a config change (legacy `BISON_*` / `LASENCE_*` variables still work). Without it `/sync/now` returns empty results and the Model Health page shows no connections.
* Login accounts are provisioned by an administrator (Supabase dashboard → Authentication → Users → *Add user* with auto-confirm; self-signup requires email confirmation).

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

*Last Updated: 2026-07-11*
