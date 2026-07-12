# FAIV Predict — Content Decision Support

> Decision support for social media specialists planning Instagram content.
> FAIV combines a historical performance estimate with a separate creative review so users can improve a content direction without treating AI as a replacement for creative judgment.

![Status](https://img.shields.io/badge/status-full--stack-7c3aed) ![Stack](https://img.shields.io/badge/stack-Next.js_15_+_FastAPI_+_Supabase-000)

---

## 1. What it does

**FAIV Predict** helps creators and small brands make a more informed content decision *before* publishing. Its result has two deliberately separate parts: a Random Forest estimate based on measurable historical inputs, and an optional AI review of the user's planned creative direction. The creative review can improve the plan and recommendations, but it does not alter or masquerade as the ML estimate.

* **Real-time predictive classifier** — hierarchical Random Forest models (shared **niche model** → dedicated **personal model** once a brand accumulates 200 mature, verified, model-supported historical posts).
* **Brand Performance Snapshot** — brand-scoped descriptive medians, interquartile ranges, and sample counts for observed format, posting-window, and structural-caption patterns before prediction. These are historical associations, not causal audience-preference claims.
* **Format-aware Creative Brief** — uses guided essentials for the goal, pillar, hook, story approach, execution direction, and CTA, then adapts its wording and production fields for Reel, Carousel, or Feed image. Users who already have a script, storyboard, design notes, bullets, or a rough idea can paste it into an optional AI intake that detects the material type and proposes normalized fields for confirmation. Existing answers are never overwritten, the pasted source is not stored, and these fields are not Random Forest features.
* **Current context** — users may describe a timely campaign, event, or trend and attach its source and observation date. This is explicitly user-provided context, not a live or external trend signal, and is used only by the creative guidance layer.
* **Separate decision signals** — the interface distinguishes the historical ML performance estimate from creative-review feedback and clearly marks creative or current context that has not been assessed.
* **Traceable content lifecycle** — an owned Content Plan can seed Predict, retain the immutable prediction snapshot, and later be linked deliberately to one verified Instagram media identity so a mature observed ER can be traced without caption guessing.
* **Calibration workspace** — test format, posting time, caption length, hashtag density, and CTA presence to see what shapes the score.
* **Explainability** — global MDI feature-importance charts and per-draft counterfactual "what-if" analysis measured by the real model. No hardcoded optimization advice is presented as evidence.

### What it is NOT
* 🚫 Not a generative AI copywriter (AI caption refinement is an optional, clearly-labeled Gemini helper).
* 🚫 Not a reach estimator — it outputs classification tiers and an uncalibrated raw class score, never absolute metrics ("+15% reach" style claims are deliberately absent).
* 🚫 Not an audience-demographics, media-vision, or live trend-intelligence product. It does not inspect uploaded images or video frames, listen to audio, discover trending audio/topics, or infer audience age/location. Visual style, hooks, storytelling, seasonal events, and trends are known only when a user describes them; that information supports the creative review but is not historical evidence or an ML feature.
* 🚫 Not a public Instagram OAuth or publishing platform. In the thesis deployment, an operator obtains and rotates the Meta credential, binds the immutable Instagram account ID to an existing owned brand through `IG_BRANDS_JSON`, and verifies the connection. End users are not asked to paste Meta tokens into the browser.

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
│ plans, publication links, lifecycle events) · Auth · Storage│
└────────────────────────────────────────────────────────────┘
```

* **Frontend**: Next.js 15 App Router, React 19, Tailwind CSS, TypeScript, framer-motion, Recharts.
* **BFF proxy**: Next.js route handlers under `frontend/app/api/*` are the only surface the browser talks to. The Supabase middleware gates them behind a login session; they attach the `INTERNAL_API_TOKEN` shared secret before forwarding to the private FastAPI service.
* **Inference engine**: FastAPI hosting Random Forest classifiers per niche/brand. If no trained model exists it returns an honest `503` — there is no fabricated fallback model.
* **Storage & Auth**: Supabase Postgres for brands/posts/predictions/model metadata; Supabase Storage for trained `.joblib` bundles; Supabase Auth for login sessions.
* **Optional LLM**: Google Gemini powers the brand classifier (`/api/classify`), Creative Brief review (`/api/analyze-concept`), and caption refinement (`/api/refine-caption`). Each reports itself unavailable (`501`) when `LLM_API_KEY` is not configured and requires an authenticated session; Creative Brief routes additionally authorize the selected brand before using safe aggregate context. The LLM receives user-authored creative/current context and a bounded aggregate history summary, but never changes the Random Forest result.
* **Automation**: one inactive-by-default n8n workflow (`n8n/workflow_sync_retrain.json`) with two schedules — a **weekly** run (Mon 06:00 WIB) that calls `POST /sync/now` to pull Instagram Graph data, reconcile mature already-confirmed publication outcomes, and retrain models, and a **daily** run (07:00 WIB) that calls `GET /instagram/health` and alerts operators if a verified connection is unhealthy. n8n never chooses a publication link. API and SMTP secrets live in encrypted n8n Credentials; `$env` access is blocked. Setup and recovery are documented below.
* **Row-Level Security**: `brands.owner_id` is the ownership root and `predictions.created_by` records the initiating user. Every authenticated user sees only owned records. Legacy predictions and posts without verifiable provenance are quarantined from user-facing metrics and model training instead of being guessed or destructively deleted. The BFF repeats ownership checks before invoking the privileged ML service.
* **CI**: GitHub Actions (`.github/workflows/ci.yml`) runs frontend lint + type-check + production build, Python Ruff checks, and the ML service test suite on every push and PR.

### BFF API surface

| Route | Purpose |
| --- | --- |
| `POST /api/predict` | Validate input, proxy to FastAPI `/predict`, persist the prediction |
| `POST /api/refine-caption` | Optional Gemini caption rewrite (501 without `LLM_API_KEY`) |
| `POST /api/classify` | Optional Gemini niche classification (501 without `LLM_API_KEY`) |
| `GET/POST /api/brands` | Brands with real per-brand post counts (`samples`) |
| `GET/PATCH/DELETE /api/history` | Immutable prediction log: list, rename/restore, soft-archive |
| `POST /api/analyze-concept` | Optional Gemini review of an unscored structured Creative Brief and user-provided Current context |
| `POST /api/normalize-brief` | Detect pasted planning material and propose structured brief fields that require user confirmation |
| `GET /api/brand-patterns` | Owned-brand descriptive performance snapshot from mature verified Graph history |
| `GET/POST/PATCH/DELETE /api/calendar` | User-owned planning records and reviewed spreadsheet imports |
| `POST /api/publication-links` | Explicitly confirm one owned prediction against one verified same-brand Instagram media ID |
| `GET /api/dashboard` | Workspace KPI aggregates (503 on database failure) |
| `GET /api/models` | Trained model registry |
| `GET/POST /api/train` | Trigger retraining and poll job status |
| `GET /api/instagram-health` | Live Instagram token validation + data freshness per linked brand |
| `POST /api/instagram-post-insights` | Supported Meta metrics for one selected, owned post |

---

## 3. Machine Learning Pipeline

1. **Data**: historical posts per brand synced from the Instagram Graph API (`POST /sync/now`), stored with engagement rate (ER) and extracted features.
2. **Features (10)**: `is_single_image`, `is_carousel`, `is_reels`, `post_hour`, `caption_length`, `hashtag_count`, `has_cta`, `is_weekend`, `has_question`, `emoji_count` — all derived from real stored posts. Caption semantics, creative-brief fields, images, video, audio, and Current context are not model inputs. The model bundle stores its own feature order, so older 7-feature artifacts keep serving correctly after the feature set grows.
3. **Labeling**: ER percentiles (P33/P67) computed **on the training split only** (no leakage) map posts to `LOW / AVERAGE / HIGH`.
   The train/test split is **chronological (80:20)** — the model trains on older posts and is validated on the newest, mirroring production use and avoiding look-ahead leakage on time-ordered data.
4. **Model**: `RandomForestClassifier(n_estimators=100, max_depth=4, min_samples_leaf=5)` — regularized for small datasets. Shared cohorts require ≥ 30 pooled eligible posts; a personal model requires ≥ 200 eligible posts from that account. Training also refuses degenerate one-class data.
5. **Evaluation and promotion**: the untouched newest 20% records accuracy, balanced accuracy, macro/weighted/per-class metrics, ordinal MAE, quadratic weighted kappa, a fixed-label confusion matrix, and comparisons with majority `DummyClassifier` and scaled Logistic Regression. Three expanding-window checks run only inside the oldest 80%, with fold-local P33/P67 thresholds; holdout permutation importance complements MDI. Operational promotion still protects runtime continuity, while a separate scientific gate marks missing classes, zero recall, weak class-aware gains, or insufficient temporal evidence as `exploratory`. The versioned `faiv-thesis-v2` evidence, hashes, runtime identity, support and warnings are stored in `models.metrics` and a companion `.evaluation.json` artifact.
6. **Serving**: model bundles (`model + thresholds + feature order + data provenance`) are uploaded to Supabase Storage, registered in the `models` table, downloaded, provenance-verified, and memory-cached by the inference service. Pre-migration models without certified Graph media IDs are not served.
7. **Hierarchy**: prediction requests resolve a brand-specific (`account`) model first, falling back to the shared niche model. The response reports which one served the request (`is_personal_model_active`).
8. **Explainability**: two complementary layers. **Global**: real MDI feature importance describes overall model behavior but is not presented as a signed local explanation; holdout permutation importance is exported as separate academic evidence. **Sensitivity scenarios**: the model re-scores single-feature variants of the same draft using observed posting hours and training-split median caption/tag anchors. These are non-causal model simulations, not guaranteed engagement uplift, and the actual edited draft must be scored again.
9. **Post provenance**: sync upserts by immutable Instagram media ID and never deletes/rebuilds historical posts. Meta `media_product_type` is retained so a Feed video is not mislabeled or trained as a Reel. A legacy row is claimed only by an exact timestamp-and-caption match; otherwise it remains quarantined. Caption similarity may remain a read-only candidate hint, but it can never create a publication link or write an “actual” outcome.
10. **Descriptive planning evidence**: Brand Performance Snapshot uses only one owned brand's mature, verified Graph history. It reports median cumulative ER, IQR, `n`, and evidence level for observed groups. It is separate from model inference, never changes a score, and may remain brand-specific when Predict falls back to a niche model. Likewise, Creative Brief and Current context can shape AI guidance but never change the historical ML estimate.
11. **Observed-outcome linkage**: a Content Plan and prediction are associated only inside the same owner and brand. A publication link is then confirmed against one immutable Instagram media ID; synchronization may attach the verified post and expose mature observed ER. This thesis deliberately stores continuous ER only and rejects new `actual_class` values. A future categorical outcome would require a new versioned schema/migration and a validated threshold/outcome contract.

---

## 4. Product Flow

The core flow lives on **`/predict`** as two focused views:

```
Plan the direction → Complete the draft → Review separate decision signals
```

* **Compose**: starts with the brand and one supported publishing format. Reel asks for an opening hook, video flow, pacing, and optional duration; Carousel asks for a cover hook, slide flow, and slide count; Feed image asks for a headline, focal point, and design direction. The same six guided essentials remain recognizable across formats, so the form is flexible without creating incompatible data. An optional **Paste script or notes** path classifies a script, storyboard, design notes, creative brief, bullets, or rough idea and fills only blank fields after the user approves the proposal. A separate **Current context** accepts a timely idea with a source and observation date. Brand Performance Snapshot says **observed**, not “audience prefers.” The date, optional posting time, and caption remain the inputs required by the historical model contract. With no time, the model frequency-weights only posting hours observed in its training split and stores an explicitly provisional result.
* **Creative review**: Gemini may review the structured brief, user-provided Current context, brand profile, and safe historical aggregates. Its strengths and suggestions are planning guidance only. It does not inspect the actual media and does not directly affect the Random Forest score. If a user explicitly applies an AI caption rewrite, that new caption becomes a model input and must be scored again. Changing only the brief or current context makes the creative review stale without falsely invalidating an unchanged ML estimate.
* **Insights**: keeps the **historical performance estimate** visually and semantically separate from the **creative review**. The primary estimate reports a relative tier and raw class scores expressed as `/100`; these are not calibrated probabilities. Model diagnostics and limitations remain available as secondary details. Edited model inputs make the ML result stale, while edited creative context requires only a new creative review.

Other pages:

* **`/dashboard`** — KPIs, model accuracy trend, recent forecasts, per-brand model status (all queried live from Supabase).
* **`/calendar`** — the Content Plan workspace for manual or reviewed CSV/XLSX entries. A supported owned entry can open Predict with its planning inputs, retain the returned immutable prediction ID, and later record a verified publication link; drag-to-reschedule, workflow metadata, and CSV/XLSX/PDF export remain available.
* **`/history`**: filterable, immutable prediction evidence. Recalculation creates a successor; user deletion is a reversible soft archive and never rewrites or destroys the scored snapshot.
* **`/insights`** — a master-detail analytics hub. The post list stays lightweight; supported Meta lifetime metrics load only for the selected post, alongside verified historical and prediction comparisons.
* **`/niches`** — brand registration with one controlled industry cohort. AI may suggest a cohort, but the user confirms it; follower counts come only from Instagram sync.
Instagram connection health is shown per brand on **`/niches`**. The daily n8n check can notify operators before a scheduled sync fails.

### Content Plan to observed outcome

```text
Owned Content Plan
  → Predict with the plan's brand, caption, format, date, and optional time
  → save one immutable prediction snapshot back to that plan
  → authenticated user explicitly confirms the published media for that prediction
  → store one immutable plan/prediction/media identity link
  → n8n-triggered Graph sync resolves and refreshes the verified post
  → after the maturity gate, expose observed cumulative ER with provenance
```

The link is intentionally explicit. The system does not infer publication
identity from caption text, posting order, or a display name, because captions
can be duplicated or edited. Changing the plan later may make its linked
prediction stale, but never rewrites the old scored snapshot or publication
identity. Observed ER is the primary realized measurement. An “actual tier” is
not manufactured from a different brand percentile or the current distribution;
the current thesis always reports the tier as unavailable. Adding one later
requires a new versioned schema/migration and proof that the original model's
thresholds and the same outcome/maturity rule are applied consistently.

n8n orchestrates scheduled connection health checks and Graph sync/retraining.
It does not own tenant authorization, create brands, choose a publication link,
or bypass database identity constraints. Core ownership and linkage invariants
remain in the authenticated BFF and Postgres.

### Historical patterns, creative direction, and current context

Brand Performance Snapshot deliberately answers a narrow question: **what
observable configurations were associated with higher or lower cumulative ER in
this brand's mature verified history?** Groups with fewer than 5 posts are
limited and are not highlighted; 5–14 are exploratory; 15 or more are
directional; the snapshot requires at least 20 eligible posts before naming a
highlight. These are UX evidence guards, not statistical significance or causal
thresholds.

Recent Graph metrics are synchronized and models are retrained weekly, while the
UI discloses evidence freshness and the recent 90-day **publishing mix**. It does
not compare recent and prior performance because the stored ER is cumulative at
the latest sync; posts of different ages have unequal opportunity to accumulate
engagement.

The **Current context** field is the thesis-scope alternative to pretending that
a live Instagram-trend feed exists. A specialist can record a relevant campaign,
event, format, audio idea, or trend, plus where and when it was observed. The AI
may then suggest how to adapt that context to the brand and Creative Brief. The
source and date preserve provenance, but do not make the entry verified platform
data and do not change the ML estimate. No automatic trend score is blended into
the Random Forest output.

Demographics, actual visual/video execution, live platform trends, Stories, Feed video, and audience
preference for semantic creative attributes remain explicitly unmeasured. A
future quantitative trend claim requires append-only metric snapshots at the
same post age (for example, 7-day ER), a sourced/versioned trend feed, historical
creative annotation, and time-aware validation.

### Bachelor-thesis scope and limitations

The implemented research contribution is a versioned, temporally evaluated
classifier for a relative likes-plus-comments engagement tier using ten observable metadata and caption-structure features. It is not evidence that the
system can judge an unfinished design or video. The Creative Brief and Current
context make the product useful earlier in the planning process, while their
separation from ML inference prevents an LLM opinion from being presented as a
measured probability.

The training outcome is cumulative ER observed after a seven-day maturity gate,
not a fixed seven-day snapshot. Older posts may therefore have had more time to
accumulate engagement. The system mitigates obvious immaturity and validates in
chronological order, but fixed-horizon snapshots are required before strong
recency, trend-uplift, or causal claims can be made. Full image/video analysis,
automatic trending-audio discovery, public Instagram OAuth, automatic
publishing, and a multimodal performance model are intentionally left as future
work rather than represented by placeholders.

---

## 5. Getting Started

### Prerequisites
Docker Desktop for the recommended full-stack run, or `Node.js 20+` and `Python 3.12` for native development, plus a Supabase project with the repository migrations applied.

### Environment
For Docker Compose, copy `.env.example` to repository-root `.env`. Native development may split the matching values between `frontend/.env.local` and `ml-service/.env`. Notes:

* `DATABASE_URL` must be a Postgres DSN, **not** the project `https://` URL.
* `SUPABASE_KEY` (ML service) should be a secret/service-role key so model artifacts can be uploaded to Storage.
* `INTERNAL_API_TOKEN` must match between the frontend and ML service. Enter that same value into the encrypted n8n Header Auth credential; do not expose it to the n8n process environment.
* `LLM_API_KEY` is optional and server-only. Use a current Gemini authorization/restricted key, keep it out of browser variables and Git, and rotate it if exposed. `LLM_MODEL` selects the server-side model and defaults to `gemini-2.5-flash`. The BFF sends the key in the `x-goog-api-key` header rather than a request URL.
* `IG_BRANDS_JSON` (ML service, optional) is the thesis deployment's **operator-assisted** Instagram connection registry. Each entry binds a Meta credential and immutable Instagram Business account ID to an existing owned `brand_id`; sync never creates brands. The first verified sync persists that identity and later mismatches fail closed. This is not public OAuth or user self-service. Without a verified binding, the UI reports the account as disconnected and never fabricates metrics.
* `IG_SYNC_POST_LIMIT` controls how many historical media rows each weekly sync may retrieve (default `500`, accepted range `1–1000`). The importer follows Meta pagination, upserts immutable media IDs idempotently, and reports whether additional Graph history was actually truncated by the configured cap. Training still uses every eligible verified row accumulated in the database; lowering a later sync limit never deletes older history.
* Meta tokens are secrets: rotate any token that appears in terminal output, screenshots, logs, or chat. The ML service suppresses HTTP client request logs and records only sanitized Graph status/type diagnostics.
* n8n has no access to application environment secrets. Create a Header Auth credential for `X-Internal-Token`, select it in both HTTP Request nodes, replace the safe `.invalid` email placeholders, and select an SMTP credential before activation. Follow the n8n setup below.
* Login accounts are provisioned by an administrator (Supabase dashboard → Authentication → Users → *Add user* with auto-confirm; self-signup requires email confirmation).

### Database setup and upgrade order

Choose exactly one path before rebuilding services that query the database:

* **Fresh Supabase project:** run `supabase_schema.sql` once. It is the canonical
  bootstrap schema and already contains the final contracts from migrations
  001–004; do not replay those upgrade migrations afterward.
* **Existing FAIV Predict database:** do not rerun `supabase_schema.sql`. Apply
  only migrations that have not already succeeded, in filename order:
  `202607110001_user_data_ownership_and_calendar.sql`,
  `202607110002_prediction_lifecycle.sql`,
  `202607120003_brand_patterns_and_media_product.sql`, then
  `202607120004_content_lifecycle_integration.sql`.

Record successful migrations in the Supabase SQL history used for the thesis
deployment. Never apply both paths blindly to the same project.

Then rebuild/restart the frontend and ML service, run one verified n8n
sync/reconcile/retrain execution, export fresh model evidence, and run
`scripts/thesis_preflight.ps1`. Migration 003 changes which videos are eligible
as Reels, so old model evidence must not be reused. Migration 004 must exist
before Content Plan enrichment, secure publication-link RPC calls, immutable
Instagram account binding, or observed-outcome reconciliation is exercised.

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
cd ml-service && ./venv/bin/pip install -r requirements-dev.txt
./venv/bin/ruff check app tests && ./venv/bin/python -m pytest
cd frontend && npm run lint && npx tsc --noEmit
```

After a final retraining run, optionally export private model evidence to the
gitignored `evidence` directory:

```powershell
New-Item -ItemType Directory -Force .\evidence | Out-Null
docker compose exec -T ml-service python -m app.thesis_evidence --format markdown |
  Out-File -Encoding utf8 .\evidence\FINAL_MODEL_EVIDENCE.md
```

Then run `scripts/thesis_preflight.ps1` on the thesis machine. It compares each
model's recorded `training_code_sha256` with the fingerprint produced by the
currently running ML container; a model trained before the deployed
preprocessing/training revision is rejected and must be retrained.

### n8n setup and recovery

1. Start the stack and wait until all services are healthy:

   ```bash
   docker compose up -d --wait --wait-timeout 180
   ```

2. For a fresh n8n volume, open `http://localhost:5678`, create the local owner,
   then import `n8n/workflow_sync_retrain.json` once. Do not re-import it into an
   existing persistent installation because that can create a duplicate or remove
   local credential assignments.
3. Create a **Header Auth** credential named `FAIV Internal API` with header
   `X-Internal-Token` and the same value used by the frontend and ML service.
   Assign it to `Check Instagram Connections` and `Sync Instagram and Retrain`.
4. Replace the `.invalid` addresses and select an encrypted SMTP credential in
   all three Email Send nodes. Never paste secrets directly into workflow JSON.
5. Keep retry enabled only for the idempotent health GET (three attempts, five
   seconds apart). Do not automatically retry the sync/retrain POST; inspect and
   rerun a failed execution manually to avoid duplicate model versions.
6. Execute both branches manually, confirm every configured brand reports a
   successful sync and training result, then activate the workflow.

The n8n database is stored in the `n8n_data` volume and credentials depend on
the stable `N8N_ENCRYPTION_KEY`. Back up both, never change the key, and never
run `docker compose down -v` unless permanent deletion is intended. To verify
the runtime exposes no application secret to editable workflow code:

```bash
docker compose exec n8n node -e "console.log({blocked:process.env.N8N_BLOCK_ENV_ACCESS_IN_NODE,hasToken:Boolean(process.env.INTERNAL_API_TOKEN),hasMlUrl:Boolean(process.env.FAIV_ML_URL)})"
```

Expected: `blocked: 'true'`, `hasToken: false`, and `hasMlUrl: false`.

This `README.md` is the repository's single documentation source. Runtime
correctness remains enforced by CI, `scripts/verify_thesis_readiness.py`, and
`scripts/thesis_preflight.ps1`.

---

*Last Updated: 2026-07-12*
