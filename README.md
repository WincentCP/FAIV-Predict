# FAIV Predict — Performance OS for Creative Work

> AI-powered content performance prediction for creative agencies and SMB social media specialists.
> A minimalist SaaS dashboard for classifying post performance tiers, diagnosing weak signals, and optimizing post configurations before publishing.

![Status](https://img.shields.io/badge/status-full--stack-7c3aed) ![Stack](https://img.shields.io/badge/stack-Next.js_15_+_FastAPI_+_Supabase-000)

---

## 1. What it does

**FAIV Predict** helps creators and small brands classify the **performance tier** (`HIGH`, `AVERAGE`, `LOW`) of Instagram posts *before* publishing them.

* **Real-time predictive classifier** — hierarchical Random Forest models (shared **niche model** → dedicated **personal model** once a brand accumulates 200 historical posts).
* **Calibration workspace** — test format, posting time, caption length, hashtag density, and CTA presence to see what shapes the score.
* **Explainability** — global MDI feature-importance charts and per-draft counterfactual "what-if" analysis measured by the real model. No hardcoded optimization advice is presented as evidence.

### What it is NOT
* 🚫 Not a generative AI copywriter (AI caption refinement is an optional, clearly-labeled Gemini helper).
* 🚫 Not a reach estimator — it outputs classification tiers and an uncalibrated raw class score, never absolute metrics ("+15% reach" style claims are deliberately absent).

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
│ retrain jobs, calendar entries) · Auth · model Storage      │
└────────────────────────────────────────────────────────────┘
```

* **Frontend**: Next.js 15 App Router, React 19, Tailwind CSS, TypeScript, framer-motion, Recharts.
* **BFF proxy**: Next.js route handlers under `frontend/app/api/*` are the only surface the browser talks to. The Supabase middleware gates them behind a login session; they attach the `INTERNAL_API_TOKEN` shared secret before forwarding to the private FastAPI service.
* **Inference engine**: FastAPI hosting Random Forest classifiers per niche/brand. If no trained model exists it returns an honest `503` — there is no fabricated fallback model.
* **Storage & Auth**: Supabase Postgres for brands/posts/predictions/model metadata; Supabase Storage for trained `.joblib` bundles; Supabase Auth for login sessions.
* **Optional LLM**: Google Gemini powers the brand classifier (`/api/classify`) and caption refinement (`/api/refine-caption`). Both report themselves unavailable (`501`) when `LLM_API_KEY` is not configured.
* **Automation**: one inactive-by-default n8n workflow (`n8n/workflow_sync_retrain.json`) with two schedules — a **weekly** run (Mon 06:00 WIB) that calls `POST /sync/now` to pull Instagram Graph API data and retrain models, and a **daily** run (07:00 WIB) that calls `GET /instagram/health` and alerts operators if a verified connection is unhealthy. API and SMTP secrets live in encrypted n8n Credentials; `$env` access is blocked. The pinned, persistent runtime and activation checklist are documented in [`n8n/README.md`](./n8n/README.md).
* **Row-Level Security**: `brands.owner_id` is the ownership root and `predictions.created_by` records the initiating user. Every authenticated user sees only owned records. Legacy predictions and posts without verifiable provenance are quarantined from user-facing metrics and model training instead of being guessed or destructively deleted. The BFF repeats ownership checks before invoking the privileged ML service.
* **CI**: GitHub Actions (`.github/workflows/ci.yml`) runs frontend lint + type-check + production build and the ML service test suite on every push and PR.

The release-time trace from each UI surface to its authenticated query and
authoritative integration is maintained in
[`docs/DATA_PROVENANCE.md`](./docs/DATA_PROVENANCE.md).

### BFF API surface

| Route | Purpose |
| --- | --- |
| `POST /api/predict` | Validate input, proxy to FastAPI `/predict`, persist the prediction |
| `POST /api/refine-caption` | Optional Gemini caption rewrite (501 without `LLM_API_KEY`) |
| `POST /api/classify` | Optional Gemini niche classification (501 without `LLM_API_KEY`) |
| `GET/POST /api/brands` | Brands with real per-brand post counts (`samples`) |
| `GET/PATCH/DELETE /api/history` | Immutable prediction log: list, rename/restore, soft-archive |
| `POST /api/analyze-concept` | Optional Gemini review of an unscored creative brief |
| `GET/POST/PATCH/DELETE /api/calendar` | User-owned planning records and reviewed spreadsheet imports |
| `GET /api/dashboard` | Workspace KPI aggregates (503 on database failure) |
| `GET /api/models` | Trained model registry |
| `GET/POST /api/train` | Trigger retraining and poll job status |
| `GET /api/instagram-health` | Live Instagram token validation + data freshness per linked brand |
| `POST /api/instagram-post-insights` | Supported Meta metrics for one selected, owned post |

---

## 3. Machine Learning Pipeline

1. **Data**: historical posts per brand synced from the Instagram Graph API (`POST /sync/now`), stored with engagement rate (ER) and extracted features.
2. **Features (10)**: `is_single_image`, `is_carousel`, `is_reels`, `post_hour`, `caption_length`, `hashtag_count`, `has_cta`, `is_weekend`, `has_question`, `emoji_count` — all derived from real stored posts. The model bundle stores its own feature order, so older 7-feature artifacts keep serving correctly after the feature set grows.
3. **Labeling**: ER percentiles (P33/P67) computed **on the training split only** (no leakage) map posts to `LOW / AVERAGE / HIGH`.
   The train/test split is **chronological (80:20)** — the model trains on older posts and is validated on the newest, mirroring production use and avoiding look-ahead leakage on time-ordered data.
4. **Model**: `RandomForestClassifier(n_estimators=100, max_depth=4, min_samples_leaf=5)` — regularized for small datasets. Shared cohorts require ≥ 30 pooled real posts; a personal model requires ≥ 200 posts from that account. Training also refuses degenerate one-class data.
5. **Evaluation and promotion**: the untouched newest 20% records accuracy, balanced accuracy, macro/weighted/per-class metrics, ordinal MAE, quadratic weighted kappa, a fixed-label confusion matrix, and comparisons with majority `DummyClassifier` and scaled Logistic Regression. Three expanding-window checks run only inside the oldest 80%, with fold-local P33/P67 thresholds; holdout permutation importance complements MDI. Operational promotion still protects runtime continuity, while a separate scientific gate marks missing classes, zero recall, weak class-aware gains, or insufficient temporal evidence as `exploratory`. The versioned `faiv-thesis-v2` evidence, hashes, runtime identity, support and warnings are stored in `models.metrics` and a companion `.evaluation.json` artifact.
6. **Serving**: model bundles (`model + thresholds + feature order + data provenance`) are uploaded to Supabase Storage, registered in the `models` table, downloaded, provenance-verified, and memory-cached by the inference service. Pre-migration models without certified Graph media IDs are not served.
7. **Hierarchy**: prediction requests resolve a brand-specific (`account`) model first, falling back to the shared niche model. The response reports which one served the request (`is_personal_model_active`).
8. **Explainability**: two complementary layers. **Global**: real MDI feature importance describes overall model behavior but is not presented as a signed local explanation; holdout permutation importance is exported as separate academic evidence. **Sensitivity scenarios**: the model re-scores single-feature variants of the same draft using observed posting hours and training-split median caption/tag anchors. These are non-causal model simulations, not guaranteed engagement uplift, and the actual edited draft must be scored again.
9. **Post provenance**: sync upserts by immutable Instagram media ID and never deletes/rebuilds historical posts. A legacy row is claimed only by an exact timestamp-and-caption match; otherwise it remains quarantined. Caption matching may provide a read-only prediction trace in Insights, but never writes an “actual” outcome. Predicted-vs-actual values are shown only when `actual_source = instagram_media_id` supplies explicit future linkage.

---

## 4. Product Flow

The core flow lives on **`/predict`** as two focused views:

```
Compose (draft the post) → Insights (everything the model has to say, one screen)
```

* **Compose**: one column with brand, format, required date, optional posting time, caption signals, and an optional AI Assistant. With no time, the model frequency-weights only posting hours observed in its training split and stores an explicitly provisional result. A legacy artifact without empirical hour metadata falls back to all 24 hours and discloses that limitation. Visual Concept is not a model feature; applying a concept-conditioned caption rewrite changes the draft and requires a new prediction.
* **Insights**: a single scrollable screen with tier, raw class scores expressed as `/100`, active model scope, holdout size, accuracy, macro-F1, balanced accuracy, majority-baseline gain, scientific status, model version, sensitivity scenarios, and global model signals. Raw Random Forest scores are explicitly not described as calibrated probabilities. Edited inputs make the result stale and disable applying old recommendations.

Other pages:

* **`/dashboard`** — KPIs, model accuracy trend, recent forecasts, per-brand model status (all queried live from Supabase).
* **`/calendar`** — a planning workspace independent from prediction history. It contains only manual or reviewed CSV/XLSX imports, supports workflow metadata, drag-to-reschedule, and CSV/XLSX/PDF export.
* **`/history`**: filterable, immutable prediction evidence. Recalculation creates a successor; user deletion is a reversible soft archive and never rewrites or destroys the scored snapshot.
* **`/insights`** — a master-detail analytics hub. The post list stays lightweight; supported Meta lifetime metrics load only for the selected post, alongside verified historical and prediction comparisons.
* **`/niches`** — brand registration with one controlled industry cohort. AI may suggest a cohort, but the user confirms it; follower counts come only from Instagram sync.
Instagram connection health is shown per brand on **`/niches`**. The daily n8n check can notify operators before a scheduled sync fails.

---

## 5. Getting Started

### Prerequisites
Docker Desktop for the recommended full-stack run, or `Node.js 20+` and `Python 3.12` for native development, plus a Supabase project with the repository migrations applied.

### Environment
For Docker Compose, copy `.env.example` to repository-root `.env`. Native development may split the matching values between `frontend/.env.local` and `ml-service/.env`. Notes:

* `DATABASE_URL` must be a Postgres DSN, **not** the project `https://` URL.
* `SUPABASE_KEY` (ML service) should be a secret/service-role key so model artifacts can be uploaded to Storage.
* `INTERNAL_API_TOKEN` must match between the frontend and ML service. Enter that same value into the encrypted n8n Header Auth credential; do not expose it to the n8n process environment.
* `IG_BRANDS_JSON` (ML service, optional) links Instagram Business accounts for the sync pipeline. Each entry must bind credentials to an existing `brand_id`; sync never creates brands. Without a configured connection, the UI reports the account as disconnected and never fabricates metrics.
* n8n has no access to application environment secrets. Create a Header Auth credential for `X-Internal-Token`, select it in both HTTP Request nodes, replace the safe `.invalid` email placeholders, and select an SMTP credential before activation. See [`n8n/README.md`](./n8n/README.md).
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
Open [http://localhost:3000](http://localhost:3000). Or run the complete stack with `docker compose up -d --build --wait --wait-timeout 180` for the first build and `docker compose up -d --wait --wait-timeout 180` thereafter, then confirm `docker compose ps` reports all three services healthy.

### Tests
```bash
cd ml-service && ./venv/bin/python -m pytest   # ML service API tests
cd frontend && npm run lint && npx tsc --noEmit
```

After a final retraining run, export the actual model evidence without exposing secrets:

```bash
docker compose exec -T ml-service python -m app.thesis_evidence --format markdown
```

The academic method, acceptance criteria, recorded verification evidence, demonstration sequence, and real-participant study protocol are maintained in [`docs/THESIS_ML_METHOD.md`](./docs/THESIS_ML_METHOD.md), [`docs/THESIS_TEST_REPORT.md`](./docs/THESIS_TEST_REPORT.md), [`docs/THESIS_DEMO_RUNBOOK.md`](./docs/THESIS_DEMO_RUNBOOK.md), and [`docs/THESIS_USABILITY_EVALUATION.md`](./docs/THESIS_USABILITY_EVALUATION.md). `scripts/analyze_usability.py` converts genuine anonymized U01–U06/SEQ/SUS response rows into a private thesis evidence report and refuses an empty participant file.

---

*Last Updated: 2026-07-12*
