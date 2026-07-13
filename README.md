# FAIV Predict

> AI-assisted decision support for planning Instagram content before publication.

FAIV Predict combines verified Instagram history, a versioned machine-learning classifier, brand-level performance patterns, and optional Gemini-assisted creative review. It helps social media specialists judge a planned post, improve its direction, and later compare the prediction with a verified published result. The system supports—not replaces—creative judgment.

## Table of contents

- [Project overview](#project-overview)
- [Features and scope](#features-and-scope)
- [Technology stack](#technology-stack)
- [System architecture](#system-architecture)
- [Project structure](#project-structure)
- [Installation](#installation)
- [Environment variables](#environment-variables)
- [Database](#database)
- [Machine learning](#machine-learning)
- [APIs](#apis)
- [Automation](#automation)
- [Frontend](#frontend)
- [Backend](#backend)
- [Prediction workflow](#prediction-workflow)
- [Third-party integrations](#third-party-integrations)
- [Security](#security)
- [Performance](#performance)
- [Testing and verification](#testing-and-verification)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [Known limitations and future work](#known-limitations-and-future-work)
- [License](#license)

## Project overview

### Background

Social media teams must commit time and budget to an idea before knowing how it will perform. Historical analytics are normally available only after publication, while generic AI copy tools do not explain whether a particular format, posting time, or caption structure resembles what has worked for a specific brand.

FAIV Predict addresses that gap with two separate decision signals:

1. A historical performance estimate produced by a Random Forest model trained only on mature, verified Instagram posts.
2. An optional creative review that uses a structured Creative Brief, user-provided current context, and safe brand-history aggregates.

The separation is intentional. Gemini guidance can help improve an idea, but it never changes or masquerades as the machine-learning result.

### Objectives

- Estimate a planned post's relative engagement tier (`LOW`, `AVERAGE`, or `HIGH`) before publication.
- Explain which measurable inputs and model-tested alternatives shaped the result.
- Show descriptive brand patterns without presenting correlation as audience causation.
- Support format-aware creative planning for Reels, Carousels, and Feed images.
- Preserve immutable prediction versions and connect them to verified published media.
- Synchronize Instagram history and retrain models through an auditable automation.
- Provide reproducible evaluation evidence suitable for a bachelor's-level information-system and applied-ML project.

### Target users

- Social media specialists
- Content strategists and creators
- Small-business or brand owners
- Project operators who maintain Instagram credentials, model training, and n8n
- Developers or researchers continuing the system

## Features and scope

### Main features

| Area | Implemented capability |
| --- | --- |
| Predict | Brand-scoped three-tier inference, optional posting time, out-of-range warnings, raw class scores, model metadata, and model-derived counterfactuals |
| Creative planning | Format-aware Creative Brief with goal, pillar, hook, storytelling style, visual direction, CTA, Reel duration, Carousel slide count, and sourced current context |
| Brief import | Optional Gemini normalizer for scripts, storyboards, design notes, creative briefs, bullet ideas, or rough concepts; proposed fields require user confirmation |
| Brand evidence | Median ER, IQR, sample size, and evidence level for observed format, daypart, caption-length, hashtag, and CTA groups |
| Content Plan | Create, edit, reschedule, import, export, and send a supported plan into Predict |
| Lifecycle | Immutable predictions, explicit supersession, provisional/stale states, soft archive/restore, audit events, and verified publication links |
| Results | Live or stored Instagram post history, supported lifetime insight metrics, and prediction-to-observed-result comparisons |
| Models | Personal/niche model registry, evaluation status, baseline comparison, and retraining jobs |
| Automation | Weekly Graph synchronization and retraining plus daily Instagram connection health checks through n8n |
| Authentication | Administrator-provisioned Supabase email/password accounts with tenant isolation through ownership checks and RLS |

### Deliberate boundaries

FAIV Predict is not an automatic publishing system, public Instagram OAuth product, absolute reach estimator, or multimodal vision model. It does not inspect images, video frames, audio, audience demographics, trending audio, or platform-wide trends. The current-context field is user-supplied and unverified. Creative Brief fields affect Gemini guidance but are not Random Forest features.

The statistical target is cumulative likes-plus-comments engagement rate observed after a seven-day maturity gate. It is not a fixed seven-day snapshot, causal uplift estimate, or calibrated probability. These boundaries are displayed in the product and should remain explicit in any presentation or research claim.

### Bachelor-thesis scope and limitations

The **historical ML performance estimate** is the research contribution: a versioned classifier built from **ten observable metadata and caption-structure features**. The **Brand Performance Snapshot** is supporting descriptive evidence; its sample thresholds are UX evidence guards, **not statistical significance** tests. The system **does not inspect the actual media**, so it cannot claim to measure visual execution quality.

The thesis uses an **operator-assisted** Instagram connection instead of public OAuth. The Predict interface provides a **Structured Creative Brief** and an optional **Paste script or notes** intake, but the **pasted source is not stored**. **Current context** requires a user-provided source and observation date and is not an external trend feed. All of these inputs remain separate from Random Forest inference.

For realized outcomes, the database still rejects new legacy `actual_class` values. Verified mature publications now use the versioned `realized_class` contract: cumulative ER is retained unchanged, while the tier is computed under the exact P33/P67 thresholds of the historical model that served the prediction. `realized_class_basis` records that model, thresholds, computation time, and maturity policy.

## Technology stack

Versions below are taken from the committed manifests and container definitions. Caret ranges may resolve to a newer compatible patch release during a fresh install; `package-lock.json` is authoritative for reproducible frontend installs.

| Layer | Technology |
| --- | --- |
| Frontend framework | Next.js `^15.5.18` App Router, React `^19.1.1`, React DOM `^19.1.1`, TypeScript `^5.8.3` |
| Styling and UI | Tailwind CSS `^3.4.17`, Plus Jakarta Sans `^5.2.8`, Radix Slot/Popover, class-variance-authority, clsx, tailwind-merge |
| Motion | Framer Motion `^12.38.0`; CSS reduced-motion fallbacks |
| Charts | Recharts `^3.8.1` |
| Dates and planning | date-fns `^4.1.0`, react-day-picker `^9.14.0` |
| Import/export | ExcelJS `^4.4.0`, jsPDF `^4.2.1`, jsPDF AutoTable `^5.0.8` |
| Icons | Lucide React `^0.575.0`, used selectively for functional controls |
| Browser/server data access | `@supabase/ssr ^0.12.0`, `@supabase/supabase-js ^2.108.2`, native `fetch` |
| Backend/API | Python 3.12, FastAPI `0.139.0`, Uvicorn `0.51.0`, Pydantic through FastAPI |
| Machine learning | scikit-learn `1.9.0`, pandas `3.0.3`, NumPy `>=2.2.0`, joblib `1.5.3` |
| Database access | PostgreSQL/Supabase, psycopg2-binary `2.9.12` |
| External HTTP | HTTPX `0.28.1` |
| Authentication/storage | Supabase Auth, PostgreSQL Row-Level Security, Supabase Storage |
| AI provider | Google Gemini REST API; default model `gemini-2.5-flash` |
| Instagram integration | Meta Graph API `v25.0` |
| Automation | n8n `2.29.10` |
| Containers | Docker, Docker Compose, Node 20 Alpine frontend image, Python 3.12 slim ML image |
| Package managers | npm with lockfile; pip with pinned requirement files |
| Quality tooling | ESLint 8, Next ESLint config, Ruff `0.14.14`, pytest `9.1.1`, GitHub Actions |

No global client-state library is used. Page and workflow state is managed with React hooks; server data is loaded through authenticated Next.js route handlers.

## System architecture

### High-level architecture

```mermaid
flowchart LR
    U[Authenticated user] -->|HTTPS / browser| NX[Next.js application]
    NX --> MW[Supabase session middleware]
    NX -->|supabase-js + user session| SB[(Supabase Postgres)]
    NX -->|X-Internal-Token| ML[FastAPI ML service]
    ML -->|psycopg2| SB
    ML -->|model artifacts| ST[Supabase Storage: models]
    ML -->|Graph API v25.0| META[Instagram Graph API]
    NX -->|optional server-side call| GEM[Google Gemini API]
    N8N[n8n scheduler] -->|encrypted Header Auth credential| ML
    N8N -->|encrypted SMTP credential| SMTP[SMTP server]
```

### Trust boundaries

- The browser calls only the Next.js application and Supabase with the user's session.
- Next.js route handlers form the backend-for-frontend (BFF). They validate input, verify the session, and enforce brand ownership.
- FastAPI is an internal service. Every non-health endpoint requires `X-Internal-Token`, unless an explicit local-only unsafe override is enabled.
- The ML service uses privileged database and Storage credentials. Those values never use a `NEXT_PUBLIC_` prefix.
- n8n stores HTTP Header Auth and SMTP secrets in encrypted credentials. Application secrets are not injected into the n8n environment, and `$env` access is blocked.

### Authentication flow

```mermaid
sequenceDiagram
    participant B as Browser
    participant N as Next.js
    participant A as Supabase Auth
    participant F as FastAPI

    B->>A: signInWithPassword(email, password)
    A-->>B: session cookie/token
    B->>N: request page or /api/*
    N->>A: getUser() and refresh session cookie
    alt no valid user
        N-->>B: redirect to / or JSON 401
    else valid user
        N->>N: verify ownership and validate payload
        N->>F: internal request + X-Internal-Token
        F-->>N: scoped result
        N-->>B: sanitized JSON/UI
    end
```

Accounts are provisioned by an administrator in Supabase Auth. The application implements sign-in and sign-out, not public self-registration or password recovery.

### Data synchronization and retraining

```mermaid
flowchart TD
    S[n8n weekly schedule or trusted manual call] --> SYNC[POST /sync/now]
    SYNC --> CFG[Validate IG_BRANDS_JSON bindings]
    CFG --> G[Fetch profile and paginated media]
    G --> BIND[Lock brand and verify immutable Instagram account ID]
    BIND --> UPSERT[Idempotent upsert by brand + Instagram media ID]
    UPSERT --> REC[Reconcile explicitly linked mature outcomes]
    REC --> COUNT{At least 200 eligible mature posts for brand?}
    COUNT -->|Yes| PERSONAL[Train personal model]
    COUNT -->|No| NICHE[Pool and train niche once after all brands sync]
    PERSONAL --> STORE[Evaluate, promote, upload, register]
    NICHE --> STORE
    STORE --> RESULT[success or partial result per brand]
```

### Folder organization

- `frontend/` contains UI pages, shared components, Supabase clients, BFF route handlers, and frontend build configuration.
- `ml-service/` contains FastAPI routes, data synchronization, feature extraction, model training/serving, evidence export, and tests.
- `supabase/` and `supabase_schema.sql` define the database bootstrap and upgrade path.
- `n8n/` contains an inactive, secret-free workflow template.
- `scripts/` contains repository, environment, and running-stack verification tools.

## Project structure

Generated folders such as `node_modules`, `.next`, Python caches, local `.env` files, and `models_cache` are intentionally omitted.

```text
.
├── .env.example                       # Root environment template for Compose
├── .github/workflows/ci.yml           # Repository, frontend, Python, and PowerShell CI
├── docker-compose.yml                 # Frontend, ML service, n8n, health checks, volume
├── README.md                          # Primary engineering and operations guide
├── LICENSE                            # Conservative academic-review use terms
├── docs/                              # Evidence status and defense/evaluation kits
├── supabase_schema.sql                # Canonical bootstrap schema for a fresh project
├── supabase/migrations/               # Ordered upgrades for an existing database
│   ├── 202607110001_user_data_ownership_and_calendar.sql
│   ├── 202607110002_prediction_lifecycle.sql
│   ├── 202607120003_brand_patterns_and_media_product.sql
│   ├── 202607120004_content_lifecycle_integration.sql
│   ├── 202607130005_realized_tier.sql
│   └── 202607130006_brand_trend_notes.sql
├── frontend/
│   ├── app/
│   │   ├── page.tsx                   # Supabase email/password sign-in
│   │   ├── layout.tsx                 # Root metadata, font, theme bootstrap
│   │   ├── globals.css                # Design tokens, light/dark themes, motion/accessibility
│   │   ├── (dashboard)/
│   │   │   ├── dashboard/page.tsx     # Workspace overview
│   │   │   ├── predict/               # Compose/Insights prediction workflow and components
│   │   │   ├── calendar/page.tsx      # Content Plan, imports, exports, scheduling
│   │   │   ├── insights/page.tsx      # Published Instagram results
│   │   │   ├── history/page.tsx       # Prediction versions and archives
│   │   │   ├── niches/page.tsx        # Brand workspaces and connection health
│   │   │   └── model-health/page.tsx  # Active model quality and retraining
│   │   └── api/                       # Authenticated Next.js BFF endpoints
│   ├── components/                    # App shell, charts, date/time and reusable UI
│   ├── tests/                         # Creative Brief and decision-helper unit tests
│   ├── lib/
│   │   ├── supabase/                  # Browser/server clients and session middleware
│   │   ├── server/                    # Server-only brand pattern context
│   │   ├── authz.ts                   # User and ownership helpers
│   │   ├── creative-brief.ts          # Brief schema, validation, serialization
│   │   ├── http-errors.ts             # Safe JSON parsing and public error mapping
│   │   └── types.ts                   # Shared frontend types
│   ├── Dockerfile                     # Multi-stage standalone Next.js image
│   ├── next.config.mjs                # Standalone build and route redirects
│   ├── package.json / package-lock.json
│   ├── tailwind.config.ts
│   └── tsconfig.json
├── ml-service/
│   ├── app/
│   │   ├── main.py                    # Lean FastAPI composition root and compatibility exports
│   │   ├── shared.py                  # Configuration, authentication, schemas, DB helper
│   │   ├── predict.py                 # Prediction APIRouter and counterfactuals
│   │   ├── train.py                   # Training-job APIRouter
│   │   ├── instagram.py               # Health, insights, reconciliation, sync router
│   │   ├── graph_client.py            # Bounded Meta Graph requests and pagination
│   │   ├── patterns.py                # Brand-pattern APIRouter
│   │   ├── preprocessing.py           # Deterministic feature extraction and labeling
│   │   ├── train_pipeline.py          # Training, evaluation, promotion, artifact storage
│   │   ├── model_loader.py            # Model lookup, validation, download, memory cache
│   │   ├── brand_patterns.py          # Descriptive planning evidence and momentum
│   │   ├── thesis_evidence.py         # Markdown/JSON/appendix evidence exporter
│   │   ├── cumulative_er_sensitivity.py # Age-confound sensitivity analysis
│   │   └── data_volume_report.py      # Data-volume and serving-scope report
│   ├── tests/                         # Unit, API, research, and schema contract tests
│   ├── Dockerfile                     # Non-root Python 3.12 image
│   ├── requirements.txt               # Runtime dependencies
│   ├── requirements-dev.txt           # pytest and Ruff
│   └── pyproject.toml                 # Ruff configuration
├── n8n/workflow_sync_retrain.json     # Inactive weekly/daily workflow template
└── scripts/
    ├── verify_thesis_readiness.py     # Static repository contracts
    ├── verify_env.sh                  # Read-only external configuration checks
    └── thesis_preflight.ps1           # Running Compose/schema/model preflight
```

## Installation

### Prerequisites

- Git
- Docker Desktop with Docker Compose v2 (recommended)
- A Supabase project
- A Supabase Auth user for each workspace operator
- A private Supabase Storage bucket named `models`
- A Meta application and Instagram Professional/Business account for live synchronization
- Optional: a Google Gemini API key and SMTP account
- For native development: Node.js 20+, npm, Python 3.12, and a PostgreSQL-compatible client connection

### 1. Clone the repository

```bash
git clone https://github.com/WincentCP/FAIV-Predict.git
cd FAIV-Predict
```

### 2. Configure Supabase

Create a Supabase project, then choose exactly one database path:

**Fresh project**

1. Open Supabase SQL Editor.
2. Run `supabase_schema.sql` once.
3. Do not run migrations 001–006 afterward; their final contracts are already included.

**Existing FAIV Predict project**

Do not rerun `supabase_schema.sql`. Apply only migrations that have not already succeeded, in filename order:

1. `202607110001_user_data_ownership_and_calendar.sql`
2. `202607110002_prediction_lifecycle.sql`
3. `202607120003_brand_patterns_and_media_product.sql`
4. `202607120004_content_lifecycle_integration.sql`

Create a private Storage bucket named `models`. The ML service uploads versioned `.joblib` artifacts to this bucket with its privileged key.

In Supabase Dashboard, open **Authentication → Users** and add an auto-confirmed email/password user. Public signup is not implemented.

### 3. Create the root environment

```bash
cp .env.example .env
```

On PowerShell:

```powershell
Copy-Item .env.example .env
```

Fill every required value described in [Environment variables](#environment-variables). `DATABASE_URL` must be a PostgreSQL DSN, not the Supabase HTTPS project URL.

Generate independent random secrets for `INTERNAL_API_TOKEN` and `N8N_ENCRYPTION_KEY`. Do not change the n8n encryption key after credentials exist.

### 4. Register brands and bind Instagram accounts

1. Start the application and sign in.
2. Create each Brand workspace in **Brands**. A brand has a name, supported niche, optional profile summary, and `Asia/Jakarta` timezone.
3. Copy the generated brand UUID from the database or authenticated API response.
4. Add one `IG_BRANDS_JSON` object per account:

```dotenv
IG_BRANDS_JSON=[{"brand_id":"00000000-0000-0000-0000-000000000000","instagram_id":"17840000000000000","access_token":"replace-with-meta-token"}]
```

The first verified sync permanently binds the brand row to that Instagram account ID. A different account ID is rejected instead of silently replacing identity.

### 5. Run with Docker Compose

First build:

```bash
docker compose up -d --build --wait --wait-timeout 180
docker compose ps
```

Subsequent starts do not need a rebuild:

```bash
docker compose up -d --wait --wait-timeout 180
```

Open:

- Application: <http://localhost:3000>
- ML liveness: <http://localhost:8000/healthz>
- n8n: <http://localhost:5678>

Useful lifecycle commands:

```bash
docker compose stop                 # stop without deleting containers or data
docker compose start                # restart existing containers
docker compose logs -f ml-service   # follow one service
docker compose down                 # remove containers/network, keep named volume
```

Do not use `docker compose down -v` unless the n8n database and encrypted credentials may be permanently deleted.

### 6. Configure n8n

Follow [Automation setup](#automation-setup). The workflow is committed inactive and cannot run successfully until HTTP Header Auth and SMTP credentials are selected in the n8n UI.

### Native development

Docker Compose is the supported full-stack path. For native development, create `frontend/.env.local` and `ml-service/.env` with the variables used by each service.

Backend:

```bash
cd ml-service
python -m venv venv
source venv/bin/activate                # Windows: .\venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Frontend, in another terminal:

```bash
cd frontend
npm ci
npm run dev
```

For native frontend development set `FASTAPI_URL=http://127.0.0.1:8000`, and use exactly the same `INTERNAL_API_TOKEN` in both service environments. n8n can remain in Docker or be omitted when testing interactive features.

### Production builds

```bash
cd frontend
npm ci
npm run build
npm run start
```

```bash
cd ml-service
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

The committed Dockerfiles are preferred: the frontend uses Next.js standalone output and a non-root runtime user; the ML image also runs as a non-root user.

## Environment variables

Never commit `.env`, `frontend/.env.local`, `ml-service/.env`, Meta tokens, service-role keys, Gemini keys, SMTP passwords, or n8n credential exports.

### Application configuration

| Variable | Required | Used by | Purpose | Placeholder example |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Browser, Next.js, Compose → ML as `SUPABASE_URL` | Supabase project HTTPS URL | `https://project-id.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Browser, Next.js | Supabase anon/publishable key for Auth and RLS-scoped requests | `sb_publishable_...` |
| `DATABASE_URL` | Yes | ML service, preflight | PostgreSQL DSN for privileged server access | `postgresql://postgres:password@db.project-id.supabase.co:5432/postgres` |
| `SUPABASE_KEY` | Yes | ML service | Secret/service-role credential for model Storage and privileged server access | `sb_secret_...` |
| `SUPABASE_URL` | Yes outside Compose | ML service | Server-side Supabase URL. Compose derives it from `NEXT_PUBLIC_SUPABASE_URL` | `https://project-id.supabase.co` |
| `FASTAPI_URL` | Yes for native Next.js; Compose supplies it | Next.js BFF | Internal ML service base URL | `http://127.0.0.1:8000` |
| `FRONTEND_URL` | No | ML service | Comma-separated additional CORS origins; localhost origins are always allowed | `https://app.example.com` |
| `INTERNAL_API_TOKEN` | Yes | Next.js, ML service, n8n encrypted Header Auth | Shared service-to-service token sent as `X-Internal-Token` | `random-64-character-secret` |
| `LLM_API_KEY` | No | Next.js server only | Enables Gemini niche suggestions, brief normalization/review, and caption refinement | `replace-with-restricted-key` |
| `LLM_MODEL` | No | Next.js server only | Gemini model name; defaults to `gemini-2.5-flash` | `gemini-2.5-flash` |
| `IG_BRANDS_JSON` | No for app; required for sync/Insights | ML service | JSON array binding existing brand UUIDs to Instagram account IDs and server-side access tokens | See binding example above |
| `IG_SYNC_POST_LIMIT` | No | ML service | Maximum media retrieved per account per sync; integer `1–1000`, default `500` | `500` |
| `PORT` | No | ML service | Uvicorn port; Compose and Dockerfile set `8000` | `8000` |
| `ALLOW_UNAUTHENTICATED_LOCAL_DEV` | No; unsafe | ML service | Allows internal routes without a token only in an isolated local sandbox; default `false` | `false` |

`ALLOW_UNAUTHENTICATED_LOCAL_DEV=true` must never be used in a shared, network-accessible, or production environment.

### n8n configuration

| Variable | Required | Purpose | Placeholder/default |
| --- | --- | --- | --- |
| `N8N_ENCRYPTION_KEY` | Yes | Encrypts credentials stored in the n8n volume; must remain stable and backed up | `at-least-32-random-characters` |
| `N8N_HOST` | No | Public/editor hostname | `localhost` |
| `N8N_PROTOCOL` | No | Editor protocol | `http` |
| `N8N_EDITOR_BASE_URL` | No | Canonical editor URL | `http://localhost:5678` |
| `N8N_WEBHOOK_URL` | No | Mapped by Compose to n8n `WEBHOOK_URL` | `http://localhost:5678/` |
| `N8N_SECURE_COOKIE` | No | Secure-cookie flag; use `false` only for local HTTP and `true` behind HTTPS | `false` |

Compose fixes the n8n port to `5678`, timezone to `Asia/Jakarta`, blocks environment access in nodes, disables telemetry/personalization/version notifications, enforces settings permissions, and prunes execution data older than 168 hours. SMTP values and notification addresses belong in encrypted n8n credentials/node settings, not `.env` or workflow JSON.

### Verification-only variables

| Variable | Script | Purpose |
| --- | --- | --- |
| `VERIFY_LOGIN_EMAIL` | `scripts/verify_env.sh` | Optional real login verification without placing credentials in arguments |
| `VERIFY_LOGIN_PASSWORD` | `scripts/verify_env.sh` | Password paired with the verification email |
| `ML_PYTHON` | `scripts/verify_env.sh` | Optional path to a Python interpreter containing psycopg2 |
| `FAIV_VERIFY_DB_URL` | Internal to script | Temporary non-printed pass-through of `DATABASE_URL`; users normally do not set it |
| `FAIV_VERIFY_IG_JSON` | Internal to script | Temporary non-printed pass-through of `IG_BRANDS_JSON`; users normally do not set it |

## Database

### Choice and access model

Supabase provides PostgreSQL, Auth, PostgREST, and object Storage. The browser uses the anon/publishable key plus a user session and is constrained by RLS. Next.js repeats ownership checks. The ML service connects through `DATABASE_URL` and is responsible for privileged prediction, sync, training, and outcome reconciliation writes.

### Tables

| Table | Purpose and important columns |
| --- | --- |
| `brands` | Ownership root: `owner_id`, name, niche, followers, immutable `instagram_account_id`, profile summary, timezone, active model type |
| `posts` | Verified synchronized media: brand, caption, cumulative ER, follower snapshot, format flags, post hour, derived caption fields, Instagram media ID, Meta product type, source, sync timestamp |
| `predictions` | Immutable score snapshot: creator/brand, caption, features JSON, predicted class, model/version/schema/input hash, optional schedule time, lifecycle state, supersession link, soft archive, verified observed ER, and serving-model realized tier/basis |
| `models` | Versioned personal or niche artifact metadata, Storage path/URL, accuracy, and complete JSON evaluation evidence |
| `model_retrain_jobs` | Background retraining status, safe error message, creation and completion timestamps |
| `calendar_entries` | User-owned Content Plan records, scheduling, format, serialized brief/details, caption, workflow status, source, and optional prediction link |
| `content_lifecycle_events` | Append-only audit events for prediction, plan, publication, and observed-outcome transitions |
| `prediction_publications` | One-to-one verified mapping between prediction, stored post, and immutable Instagram media ID |
| `brand_trend_notes` | Owner-scoped, bounded, user-provided trend/context notes with source and observation date; advisory only and excluded from ML |

### Key relationships and consistency rules

- Deleting an Auth user cascades owned brands and plans; dependent posts are brand-owned.
- A prediction references exactly one brand and the user who created it.
- A prediction snapshot cannot have scored inputs rewritten. Re-evaluation creates one successor with a reason: `inputs_changed`, `time_finalized`, or `manual_rerun`.
- Unknown-time predictions are `provisional`; known-time active predictions are `current`.
- User deletion is a reversible soft archive. Hard deletion and arbitrary scored-field updates are revoked.
- A Content Plan may link only to a prediction owned by the same user and, when both have brands, the same brand.
- Each prediction and each verified post can have only one publication mapping. The brand/media pair is also unique.
- `actual_er` may be written only from an explicitly linked verified Instagram post after the seven-day maturity gate.
- New legacy `actual_class` values remain rejected. `realized_class` is attached only by privileged mature-publication reconciliation and must match the original serving model's persisted thresholds; the continuous observed ER remains available.
- The first successful Graph sync stores `brands.instagram_account_id`; a trigger prevents identity replacement.

### Indexes

Important indexes cover:

- unique `(brand_id, instagram_media_id)` and verified post history by brand/date;
- prediction owner/status/history, supersession, model, and input hash;
- one-successor-per-prediction;
- models by brand and niche;
- plans by owner/date;
- lifecycle events by owner, prediction, and plan;
- unique brand Instagram account identity;
- publication mappings by owner/brand/time plus their unique constraints.

### Row-Level Security

RLS is enabled on all nine tables.

- Brand CRUD is restricted to `owner_id = auth.uid()`; column grants prevent clients from writing followers or Instagram identity.
- Authenticated users may read only verified Graph posts belonging to owned brands.
- Predictions are visible only to their creator for an owned brand. Only title and soft-archive state are client-updatable.
- Models are visible only when their account belongs to the user or their niche matches an owned brand, and only with verified Graph provenance.
- Retraining jobs are readable through their owned brand.
- Content Plan CRUD requires the owner and validates referenced brand/prediction ownership.
- Lifecycle events and publication links are read-only for their owner. Privileged functions/triggers perform writes.
- Trend notes allow owner-scoped select/insert/delete only; client updates are not granted, and SQL constraints repeat all BFF length/date bounds.
- Anonymous users receive no application data.

### Migration process

`supabase_schema.sql` is the canonical final schema for a new project. The six migration files are upgrades for an older installation; do not blindly combine both paths. Apply SQL in Supabase SQL Editor and record successful execution. Rebuild services after schema changes.

Migration 003 changes Reel eligibility by preserving `media_product_type`; migration 004 adds publication cohesion and continuous observed outcomes; migration 005 adds the historical-serving-model realized tier; migration 006 adds owner-scoped trend notes. Models trained against older training logic or schema must be retrained before serving.

## Machine learning

### Dataset

Training uses only database rows that satisfy all of the following:

- `source = 'instagram_graph'`;
- immutable `instagram_media_id` is present;
- ER, post hour, and creation time are available;
- the post is at least seven complete days old;
- format is a single image, Carousel, or a video explicitly identified by Meta as `REELS`.

Feed videos, Stories, unsupported/incomplete media, unverified legacy rows, and immature posts remain available for audit where appropriate but do not train the classifier. No synthetic fallback dataset is generated.

Engagement rate is computed from likes plus comments divided by the follower count captured by synchronization. The stored outcome is cumulative at the latest sync after the maturity gate, not an equal-age snapshot.

### Feature engineering

The current `FEATURE_ORDER_V2` has ten deterministic features:

| Feature | Meaning |
| --- | --- |
| `is_single_image` | One-hot Feed image flag |
| `is_carousel` | One-hot Carousel flag |
| `is_reels` | One-hot verified Reel flag |
| `post_hour` | Asia/Jakarta hour extracted from the timestamp |
| `caption_length` | Character count |
| `hashtag_count` | Hashtag count |
| `has_cta` | Rule-based CTA phrase detection |
| `is_weekend` | Saturday/Sunday in Asia/Jakarta |
| `has_question` | Caption contains `?` |
| `emoji_count` | Unicode emoji count |

Feature order is stored in every model bundle. The loader can still recognize an older seven-feature bundle, but serving also requires verified Graph provenance, a recognized evaluation contract, and a passed operational promotion gate.

Creative Brief semantics, raw pasted material, image/video content, audio, demographics, and current-context text are not model inputs.

### Labels and preprocessing

Posts are ordered chronologically. The oldest 80% form the training portion and the newest 20% form the untouched holdout. P33 and P67 are calculated only on the training portion:

```text
LOW      if ER < P33
AVERAGE  if P33 <= ER <= P67
HIGH     if ER > P67
```

Training stops if percentile ties or limited variation remove any of the three training classes.

### Model

The production candidate is:

```python
RandomForestClassifier(
    n_estimators=100,
    max_depth=4,
    min_samples_leaf=5,
    random_state=42,
)
```

Regularized depth and leaf size reduce overfitting risk on small datasets. A shared niche model requires at least 30 eligible posts pooled within a niche. A personal account model requires at least 200 eligible posts for that brand. Inference resolves the newest promoted personal model first, then falls back to the newest promoted niche model derived from the stored brand niche.

### Validation and evaluation

Every candidate records:

- balanced accuracy, macro/per-class precision, recall and F1, quadratic weighted kappa, and ordinal mean absolute error;
- raw accuracy and weighted metrics as secondary context;
- fixed-label confusion matrix;
- class support in train and holdout;
- comparison with a majority `DummyClassifier`;
- comparison with scaled Logistic Regression;
- three expanding-window evaluations within the oldest 80%, with fold-local thresholds;
- holdout permutation importance using balanced accuracy;
- dataset SHA-256, training-source SHA-256, runtime/dependency evidence, feature ranges, thresholds, and reference values.

#### Why operational and scientific gates are separate

Operational promotion and scientific interpretation are separate:

- A candidate is registered only when holdout accuracy beats the majority baseline. A rejected candidate leaves the previous model active.
- A registered model is marked `validated` only when all scientific gates pass: complete holdout classes, no zero recall for observed classes, positive class-aware gains, at least two evaluable temporal folds, and positive gain in a majority of them.
- Otherwise the model remains operational but is marked `exploratory`; the UI and evidence must limit claims accordingly.

### Prediction pipeline

1. Validate the owned brand, caption (1–2,200 characters), supported format, real schedule date, and optional integer hour.
2. Load and provenance-check the latest personal or niche artifact.
3. Derive the ten features in the artifact's stored order.
4. If time is known, score one vector. If unknown, score the posting hours observed in the model's training split and combine class scores using their observed frequencies; mark the result provisional.
5. Return the winning class, raw class scores, input-range warnings, model metadata, MDI feature importances, and single-feature what-if scenarios.
6. Persist the prediction and model identity before returning it to the browser.

The displayed class scores are raw `predict_proba` outputs from an uncalibrated classifier. They are shown as relative scores out of 100, not guaranteed probabilities.

### Explainability

- MDI importance describes global model behavior; it is not a signed explanation for one draft.
- Counterfactuals re-score the same draft with one changed input. Candidate hours and caption/hashtag anchors come from the training portion where available.
- Counterfactual deltas are model sensitivity tests, not causal engagement uplift.
- Brand patterns are descriptive medians/IQRs and never change the prediction.

### Artifact storage and versioning

Each successful run creates a collision-resistant UTC timestamp plus random suffix. A bundle contains the classifier, thresholds, feature order/ranges, observed-hour support, comparison anchors, evaluation record, and data provenance. It is uploaded under `models/account/` or `models/niche/`, then registered transactionally in `models`.

The loader validates structure, three-class support, feature count, Graph provenance, evaluation contract, and promotion status. Downloaded models are cached in memory and a bounded local cache; durable truth remains Supabase Storage plus the `models` table.

### ML limitations

- Cumulative ER gives older posts more opportunity to collect engagement than newer mature posts.
- Labels are relative to the training population and should not be compared as absolute performance across unrelated brands.
- Small or imbalanced holdouts can produce exploratory models.
- The system models associations in structured metadata and caption form, not creative execution quality.
- It does not quantify uncertainty with calibrated probabilities or prediction intervals.
- Trend/context adaptation is qualitative Gemini guidance, not a trained trend feature.

## APIs

All browser-facing `/api/*` routes require a valid Supabase session. Middleware returns JSON `401` for unauthenticated API calls. Routes validate payloads, enforce ownership, return sanitized messages, and avoid leaking provider/database details.

### Next.js BFF endpoints

| Method and route | Input | Main response | Notes/errors |
| --- | --- | --- | --- |
| `POST /api/predict` | JSON: `brand_id`, `caption`, `format`, `scheduled_date`, optional `post_hour`, optional `supersedes_prediction_id` | Tier, raw scores, saved `prediction_id`, lifecycle context, model metadata, OOD fields, counterfactuals, importances | 60 s timeout; `400/404/409`, `503` no model/service, `504` timeout |
| `POST /api/analyze-concept` | `brand_id`, `format`, structured `brief` (legacy serialized `concept` accepted), optional `caption` | Sanitized creative analysis and evidence-use flags | Gemini optional; `501` if not configured; does not change prediction |
| `POST /api/normalize-brief` | `brand_id`, supported `format`, `raw_input` (5–12,000 chars) | Material type, optional format suggestion, validated brief proposal, ambiguity notes | Gemini optional; user confirmation required; source material not persisted |
| `POST /api/refine-caption` | `brand_id`, `format`, `caption`, optional `visual_concept` | Proposed refined caption | Gemini optional; applying it requires a new prediction |
| `GET /api/brand-patterns?brand_id=UUID` | Owned brand query | Aggregate pattern groups, highlights, freshness/evidence metadata | No captions or media IDs returned |
| `GET /api/brands` | None | Owned brands, eligible sample counts, active personal/niche/none scope | Private no-store response |
| `POST /api/brands` | `name`, supported `niche`, optional `profile_summary`, optional `timezone` | Created brand | Only `Asia/Jakarta`; duplicate owner/name returns `409` |
| `GET /api/calendar` | Optional `plan_id` | All owned plans or one enriched plan with prediction/publication/outcome data | Owner scoped |
| `POST /api/calendar` | One plan object or an array | Inserted plans | Validates brand, date/time, format, workflow enums, field lengths, prediction ownership |
| `PATCH /api/calendar` | `id` plus writable plan fields | Updated plan | Only allowlisted fields; database trigger may stale linked prediction |
| `DELETE /api/calendar` | `id` | Deletion confirmation | Owned plan only; restrictive links prevent unsafe deletion |
| `GET /api/history` | None | Visible prediction snapshots with publication ER, realized tier/basis, and ordinal comparison badge | Immutable evidence ordered newest first |
| `PATCH /api/history` | Prediction `id` plus rename or restore/archive action | Updated display/archive state | Scored fields cannot be edited |
| `DELETE /api/history` | Prediction `id` | Soft-archive confirmation | No hard delete |
| `POST /api/publication-links` | `prediction_id`, numeric `media_id`, `confirmed: true` | Verified publication mapping | Same owner/brand, verified post, uniqueness checks; confirmation is mandatory |
| `GET /api/instagram-posts?brand_id=UUID` | Owned brand | Up to 24 live/fallback posts and provenance | BFF calls internal endpoint with limit 24; degraded stored fallback is supported |
| `POST /api/instagram-post-insights` | `brand_id`, numeric `media_id` | Supported metrics, unavailable metrics, comparison eligibility, candidate prediction context | Verifies account/media ownership through Meta |
| `GET /api/instagram-health` | None | Sanitized health for all owned brands | Always sends tenant-scoped IDs; 20 s timeout |
| `GET /api/dashboard` | None | Prediction/model/brand counts, tier mix, status counts, recent predictions, model accuracy trend, and realized-tier verification aggregate | `503` on aggregate failure; never returns fabricated zeros after a failed query |
| `GET /api/models` | None | Latest relevant promoted personal/niche models and evaluation summaries | Verified Graph models only |
| `GET /api/trend-notes?brand_id=UUID` | Owned brand query | Up to 100 user-provided notes with computed staleness | Owner scoped; private no-store response |
| `POST /api/trend-notes` | `brand_id`, note, source, observed date, optional tag | Created trend note | SQL and BFF enforce matching bounds; notes remain outside ML |
| `DELETE /api/trend-notes` | Trend note `id` | Deletion confirmation | Owner scoped; updates are intentionally unsupported |
| `POST /api/train` | `brand_id` | Background `job_id` and pending state | Verifies brand ownership; 30 s start timeout |
| `GET /api/train?job_id=UUID` | Retraining job ID | `pending`, `running`, `success`, or `failed` with timestamps/safe error | Verifies job through owned brand; 20 s timeout |
| `POST /api/classify` | `name`, optional `bio` | Up to three supported niche suggestions with reasons | Max request 8 KiB; manual selection remains available; `501` without Gemini |

Request and response schemas are implemented directly in each `frontend/app/api/*/route.ts`. There is no separately generated OpenAPI document for the BFF.

### Internal FastAPI endpoints

Except `/healthz`, send `X-Internal-Token: <INTERNAL_API_TOKEN>`.

| Method and route | Parameters/body | Purpose |
| --- | --- | --- |
| `GET /healthz` | None | Process liveness only; does not claim database/Graph readiness |
| `POST /predict` | Strict `PredictionRequest`: caption, format, optional hour, brand/niche, date, creator, optional supersession pair | Load, score, persist, and return a prediction |
| `POST /train` | `brand_id` or `niche` | Create a database job and run training as a FastAPI background task |
| `GET /train/{job_id}` | UUID path | Read durable job state; interrupted jobs older than 30 minutes are failed before another job is queued |
| `GET /instagram/health` | Optional comma-separated `brand_ids` (max 100) | Live token/account check plus latest sync; omitted scope is reserved for trusted operator diagnostics |
| `GET /brand/patterns` | `brand_id` | Aggregate mature verified brand history |
| `GET /instagram/posts` | `brand_id`, optional `limit` clamped to 1–50 | Live media plus stored ER/comparison provenance; falls back to stored history when possible |
| `POST /instagram/post-insights` | Strict `brand_id`, numeric `media_id`, `created_by` | Fetch available lifetime metrics and safe prediction-comparison context |
| `POST /sync/now` | None | Synchronous multi-brand Graph sync, outcome reconciliation, and personal/niche retraining |

FastAPI rejects extra Pydantic fields on prediction, training, and insight bodies. Common status meanings are `400/422` invalid input, `401` invalid internal token, `404` missing scope/job, `503` unavailable model/database, and `500` sanitized internal failure. Graph-dependent routes may use `502` when the provider fails and no safe fallback exists.

## Automation

### Workflow: FAIV Predict - Verified Sync and Retrain

The committed `n8n/workflow_sync_retrain.json` is inactive by design and contains no secrets.

| Trigger | Actions | Success/failure behavior |
| --- | --- | --- |
| Monday 06:00 Asia/Jakarta | `POST http://ml-service:8000/sync/now` | Full success sends summary email. Any partial/failed brand sends failure email, then Stop and Error |
| Daily 07:00 Asia/Jakarta | `GET http://ml-service:8000/instagram/health` | Healthy connections end silently. Any unhealthy connection sends a warning email, then Stop and Error |

The workflow has two HTTP nodes, three email nodes, conditional branches, and explicit failure nodes. It does not create brands, choose publication links, refresh Meta tokens, publish content, or bypass database ownership.

### Automation setup

1. Start the Compose stack and open <http://localhost:5678>.
2. On a fresh `n8n_data` volume, create the local n8n owner.
3. Import `n8n/workflow_sync_retrain.json` once. Re-importing into an existing installation creates a duplicate and loses local credential assignments.
4. Create an **HTTP Header Auth** credential named `FAIV Internal API`:
   - Header name: `X-Internal-Token`
   - Value: exactly the application's `INTERNAL_API_TOKEN`
5. Assign it to **Check Instagram Connections** and **Sync Instagram and Retrain**.
6. Create an encrypted SMTP credential and assign it to all three email nodes.
7. Replace `.invalid` sender/recipient placeholders in each email node.
8. Execute both branches manually. Confirm every configured brand reports successful sync and training.
9. Activate the workflow.

### Failure handling and retries

- Sync upserts are idempotent by brand/media identity, and same-brand syncs are serialized with a database row lock.
- A multi-brand run returns `partial` when any sync or training fails; n8n deliberately marks that execution failed.
- The committed template does not automatically retry the sync/retrain POST. Inspect logs/credentials, then rerun manually to avoid unnecessary duplicate model versions.
- There is no message queue or dead-letter queue in thesis scope.
- Docker restarts unhealthy processes with `unless-stopped`; this is process recovery, not workflow replay.
- n8n execution records older than seven days are pruned by Compose. Durable model and lifecycle evidence remains in Supabase.

## Frontend

### Routes and user journey

| Route | Product role |
| --- | --- |
| `/` | Sign-in page; authenticated users redirect to Overview |
| `/dashboard` | Workspace overview and recent priorities |
| `/predict` | Compose a structured plan, run prediction/creative review, and inspect decision signals |
| `/calendar` | Content Plan with scheduling, workflow status, import/export, and Predict handoff |
| `/insights` | Published results and per-post Graph insights |
| `/history` | Prediction version history, archive/restore, and observed outcomes |
| `/niches` | Brand creation, maturity, Instagram connection state, and profile context |
| `/model-health` | Active model evidence and retraining controls |

The old `/result` and `/diagnose` routes redirect to `/predict`.

### Component architecture

- `AppShell` provides responsive sidebar/topbar navigation, user menu, theme switcher, focus handling, mobile dialog, and skip link.
- The Predict page is split into focused components for Compose, Insights, format-aware brief import, brand patterns, editable Trend Insights, caption refinement, AI review, trust metadata, and measured alternatives.
- Reusable components cover tier badges, predicted-vs-observed outcomes, the glossary, model maturity, feature charts, score explanations, date/time input, headers, and base buttons/popovers.
- Server-only brand context remains under `lib/server` to keep privileged calls out of client bundles.

### State and data flow

React hooks hold page-local form, loading, stale, and result state. Fetch calls target BFF routes; no browser code calls FastAPI or Gemini directly. Supabase browser code is limited to Auth/session operations, while route handlers use server clients and ownership helpers.

### Design system and accessibility

- Plus Jakarta Sans is loaded locally through Fontsource.
- CSS custom properties define a purple primary palette, semantic surfaces, borders, statuses, shadows, light and dark themes.
- Tailwind supplies consistent spacing and responsive breakpoints.
- Interactive controls expose focus-visible states, labels, disabled/loading states, and minimum touch targets.
- The shell implements a skip link, keyboard-contained mobile navigation, Escape handling, and focus restoration.
- Framer Motion drives short transitions; `prefers-reduced-motion` is respected.
- Layouts collapse for mobile and progressively use wider columns/cards on larger screens.

### Import and export

The Content Plan supports reviewed spreadsheet imports and CSV/XLSX/PDF exports in the browser. Imported rows are still validated again by the server before insertion. File-based planning is not a background ingestion pipeline.

## Backend

### Next.js BFF

There is no separate Node controller framework. Each `route.ts` is a server route handler combining authentication, validation, ownership checks, orchestration, and response shaping. Shared concerns live in:

- `authz.ts` for users and owned brands;
- `http-errors.ts` for bounded JSON parsing, public errors, and upstream-message allowlisting;
- `brand-pattern-context.ts` for secure brand evidence retrieval;
- Supabase server/middleware helpers for cookies and sessions.

Provider responses are sanitized before they reach the browser. Critical external calls use timeouts. Prediction persistence occurs inside FastAPI so a successful UI result is not returned without durable provenance.

### FastAPI service

`main.py` is a small composition root: it configures CORS, registers `/healthz`, and includes the `predict`, `train`, `instagram`, and `patterns` APIRouters. Shared authentication, request schemas, and database configuration live in `shared.py`; bounded Meta requests live in `graph_client.py`. Compatibility re-exports keep established scripts and imports working without concentrating endpoint behavior back in the composition root.

Scientific logic remains separated in `preprocessing.py`, `train_pipeline.py`, `model_loader.py`, and `brand_patterns.py`. Database connections are opened per operation and closed in `finally` blocks. User-facing messages are generic; detailed exceptions remain in service logs.

## Prediction workflow

```mermaid
sequenceDiagram
    participant U as User
    participant UI as Predict UI
    participant BFF as Next.js BFF
    participant ML as FastAPI
    participant DB as Supabase Postgres
    participant ST as Supabase Storage
    participant G as Gemini (optional)

    U->>UI: choose brand, format, schedule, caption
    U->>UI: complete Creative Brief/current context
    opt paste existing material
        UI->>BFF: POST /api/normalize-brief
        BFF->>G: normalize into constrained JSON
        G-->>BFF: proposed fields
        BFF-->>UI: proposal requiring confirmation
    end
    opt request creative review
        UI->>BFF: POST /api/analyze-concept
        BFF->>DB: load owned brand + safe aggregates
        BFF->>G: structured review request
        G-->>UI: separate creative guidance
    end
    U->>UI: run prediction
    UI->>BFF: POST /api/predict
    BFF->>DB: verify session and owned brand
    BFF->>ML: validated inputs + user + internal token
    ML->>DB: resolve newest promoted model metadata
    ML->>ST: download if not cached
    ML->>ML: extract features and score
    ML->>DB: insert immutable prediction/version link
    ML-->>UI: tier, scores, trust data, what-if results
    U->>UI: review result and improve draft
```

After publication:

1. Graph sync stores the Instagram post by immutable media ID.
2. The user explicitly confirms which same-brand media belongs to the prediction.
3. `prediction_publications` stores the one-to-one identity link.
4. Synchronization refreshes the post and invokes database reconciliation.
5. Once mature, verified cumulative ER is copied into the prediction; when the serving model has persisted thresholds, its realized tier and complete threshold basis are computed atomically.
6. The lifecycle event table records prediction, plan, publication, stale/superseded, archive, and observed-outcome changes.
7. Future retraining consumes the verified post independently of the prediction; predictions are evidence, not training labels manufactured from user expectations.

### Staleness rules

- Editing caption, format, date, or known posting hour after a score requires a new prediction version.
- Adding a previously unknown time creates a successor with `time_finalized`.
- Re-running unchanged inputs creates a `manual_rerun` successor so model-version changes remain traceable.
- Editing only Creative Brief/current-context fields makes the separate creative review stale but does not falsify an unchanged ML input snapshot.
- Editing a linked Content Plan can mark its prediction stale through a database trigger; the old prediction remains immutable.

## Third-party integrations

### Supabase

Purpose: Auth, PostgreSQL, PostgREST/RLS, and model object Storage.

- Browser authentication uses the anon/publishable key.
- Privileged ML operations use `DATABASE_URL` and `SUPABASE_KEY` server-side.
- RLS isolates owned brands and dependent records.
- The private `models` bucket stores versioned joblib bundles.

Limitations: the repository does not provision the Supabase project, bucket, SMTP Auth settings, or Auth users automatically. SQL must be applied before the app starts querying final-schema columns.

### Meta Graph API

Purpose: profile follower count, media history, captions, media/product types, timestamps, likes/comments, previews/permalinks, account health, and supported post lifetime insights.

Authentication uses operator-managed server-side access tokens in `IG_BRANDS_JSON`. The application never asks an end user to paste a token into the browser. Sync follows pagination up to `IG_SYNC_POST_LIMIT`, validates required fields, preserves stored history, and never deletes rows because a later sync has a smaller limit.

Limitations: public OAuth, automatic token refresh, token exchange, publishing, Stories modeling, and audience demographics are not implemented. Meta metric availability varies by media type, permissions, and API version; unsupported values remain unavailable rather than becoming zero.

### Google Gemini

Purpose: optional niche suggestions, structured brief normalization, Creative Brief review, and caption refinement.

Calls originate only from Next.js server routes using `x-goog-api-key`, explicit timeouts, bounded inputs/outputs, low temperatures, constrained JSON schemas, and prompts that treat user text as untrusted data. Brand ownership is verified before context is sent. No Gemini output changes the Random Forest score unless a user explicitly applies a caption change and requests a new prediction.

Limitations: helpers return `501` when no key is configured and can fail independently without blocking manual planning or ML inference. Output remains advisory and must be reviewed by a user.

### n8n and SMTP

n8n schedules internal health and sync calls. Header Auth and SMTP credentials are encrypted using the stable `N8N_ENCRYPTION_KEY` in the persistent `n8n_data` volume. SMTP provider, user, password, host, port, and TLS settings are configured in n8n UI.

## Security

- **Authentication:** Supabase email/password sessions are checked with `getUser`, not trusted from client state alone.
- **Authorization:** RLS plus BFF ownership queries scope every brand, plan, prediction, job, model, post, and creative-context request.
- **Internal API protection:** timing-safe comparison of `X-Internal-Token`; only `/healthz` is public.
- **Least exposure:** privileged keys and LLM/Meta tokens are server-only. `NEXT_PUBLIC_*` is reserved for Supabase public configuration.
- **Secret storage:** root/service `.env` files are ignored; n8n secrets use encrypted credentials; workflow JSON contains placeholders only.
- **Input validation:** bounded JSON parsing, format/date/hour/UUID enums and regexes, length limits, Pydantic `extra=forbid`, safe import validation, and Gemini schema normalization.
- **Tenant consistency:** immutable Instagram identity, same-owner/same-brand publication checks, one-to-one unique links, and database triggers protect cross-module integrity.
- **Auditability:** append-only lifecycle events, immutable prediction snapshots, model/dataset/code hashes, and retraining jobs.
- **Privacy:** Gemini receives only user-authored planning data, user-provided profile context, and bounded aggregate history—not Meta tokens or raw historical captions.
- **Network exposure:** Compose binds all services to `127.0.0.1`; production requires an HTTPS reverse proxy and should not expose FastAPI or n8n publicly without additional controls.
- **Logging:** HTTPX request logging is suppressed in the ML service because Meta access tokens appear in Graph query strings. Rotate any token exposed in a terminal, screenshot, chat, or log.

Before allowing additional n8n editors, retain `N8N_BLOCK_ENV_ACCESS_IN_NODE=true`, use credential-level access controls, and back up both `n8n_data` and `N8N_ENCRYPTION_KEY` securely.

## Performance

Implemented optimizations:

- Next.js standalone production output, route-level code splitting, static generation where possible, and server route handlers for sensitive work.
- Parallel Supabase queries for dashboard/model aggregates.
- `Cache-Control: private, no-store` for user-specific/live evidence.
- Model memory cache plus bounded local artifact cache to avoid repeated Storage downloads.
- Vectorized batch counterfactual scoring.
- Graph pagination with a bounded per-run cap and per-page size.
- Database indexes for tenant/date/status/model/media access paths.
- Live Instagram CDN URLs fetched only when needed; stored verified history provides a degraded fallback.
- FastAPI background tasks keep interactive retraining requests from holding the browser connection.
- External API timeouts and sanitized degraded/error states.
- Responsive layouts and limited, reduced-motion-aware animations.

Current scalability limits:

- Retraining uses in-process FastAPI background tasks, not a durable worker queue.
- `/sync/now` is synchronous and processes configured brands sequentially before shared-niche training.
- psycopg2 connections are per operation; no explicit application pool is configured.
- Model cache is process-local, so horizontally scaled instances download/cache independently.
- n8n uses its local persistent database and is configured as one instance.

These choices are appropriate for the current thesis/demo scale but should be redesigned before high-volume multi-tenant deployment.

## Testing and verification

### Local checks

```bash
cd frontend
npm ci
npm audit --audit-level=moderate
npm test
npm run lint
npx tsc --noEmit
npm run build
```

```bash
cd ml-service
python -m venv venv
source venv/bin/activate
pip install -r requirements-dev.txt
ruff check app tests
python -m pytest -q
```

Static repository contract:

```bash
python scripts/verify_thesis_readiness.py
bash -n scripts/verify_env.sh
```

Read-only external configuration checks:

```bash
VERIFY_LOGIN_EMAIL='user@example.com' \
VERIFY_LOGIN_PASSWORD='replace-securely' \
bash scripts/verify_env.sh
```

The script verifies Supabase reachability, optional login, required schema, Instagram binding shape, sync limit, model Storage access, optional Gemini key, and the secret-free n8n template. It never prints configured secrets.

### Running-stack preflight (Windows PowerShell)

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\thesis_preflight.ps1
```

It checks Docker/Compose, container health, HTTP readiness, n8n secret isolation, migration contracts, model evaluation contracts, training-source fingerprints, and Git ignore protection. Use `-SkipModelEvidence` only for infrastructure diagnosis; it weakens final readiness verification.

### Export model evidence

```powershell
New-Item -ItemType Directory -Force .\evidence | Out-Null
docker compose exec -T ml-service python -m app.thesis_evidence --format markdown |
  Out-File -Encoding utf8 .\evidence\FINAL_MODEL_EVIDENCE.md
docker compose exec -T ml-service python -m app.thesis_evidence --format json |
  Out-File -Encoding utf8 .\evidence\FINAL_MODEL_EVIDENCE.json
```

The Markdown export includes the compact per-scope appendix. The `evidence/` directory is intentionally untracked. A final export is valid only after the final sync/retrain and when the model training-code hash matches the running source.

Run the read-only research reports against that same frozen database and record their output beside the evidence:

```bash
docker compose exec -T ml-service python -m app.cumulative_er_sensitivity --help
docker compose exec -T ml-service python -m app.data_volume_report --help
```

Defense and human-evaluation preparation lives in `docs/DEFENSE_KIT.md`, `docs/DEFENSE_DEMO_SCRIPT.md`, and `docs/USER_EVALUATION_PROTOCOL.md`. These documents deliberately distinguish prepared procedures from empirical runs that still require the thesis machine, private credentials, or real participants.

### Continuous integration

GitHub Actions runs on pushes and pull requests to `main`:

- repository contract and Compose interpolation;
- PowerShell parser and Python-argument quote roundtrip on Windows;
- npm clean install, vulnerability audit, unit tests, lint, type check, and production build;
- Python dependency install, Ruff, and pytest.

## Deployment

### Recommended thesis/demo deployment order

1. Provision Supabase and apply the correct schema path.
2. Create the private `models` bucket and Auth users.
3. Configure `.env`, brand rows, Instagram bindings, and optional Gemini key.
4. Build/start `ml-service`; verify `/healthz`.
5. Build/start `frontend`; verify sign-in and owned brand access.
6. Start n8n with a stable encryption key, import/configure/test the workflow, then activate it.
7. Run one complete Graph sync and retraining cycle.
8. Export evidence and run the full PowerShell preflight.

### Docker deployment

```bash
docker compose config --quiet
docker compose up -d --build --wait --wait-timeout 180
docker compose ps
```

For code-only restarts without dependency changes:

```bash
docker compose up -d --wait --wait-timeout 180
```

Rebuild a single changed image when appropriate:

```bash
docker compose up -d --build --wait frontend
docker compose up -d --build --wait ml-service
```

### Production hardening outside local demo

- Put Next.js behind an HTTPS reverse proxy.
- Keep FastAPI private on an internal network; do not publish port 8000.
- Restrict n8n by network, strong owner credentials, and HTTPS; set `N8N_SECURE_COOKIE=true`.
- Change public editor/webhook URLs to their HTTPS values.
- Use a managed secret store and rotate internal, Supabase, Meta, Gemini, and SMTP credentials.
- Add database connection pooling, backups, monitoring, and restore tests.
- Persist/ship application logs without query-string secrets.
- Back up n8n data together with its encryption key.

The repository does not include Terraform, Kubernetes, hosted-domain configuration, or a cloud-specific deployment manifest.

## Troubleshooting

### `DATABASE_URL is required` during Compose interpolation

Ensure the file is named exactly `.env` in the same directory as `docker-compose.yml`, not `.env.txt`, and run Compose from the repository root:

```powershell
Get-ChildItem -Force .env
docker compose config --quiet
```

`DATABASE_URL` must be a PostgreSQL URI. A Supabase project HTTPS URL is not valid.

### Port 3000 is already in use

On Windows:

```powershell
netstat -ano | findstr :3000
tasklist /FI "PID eq <PID>"
```

Stop the existing process/container, then run `docker compose up -d frontend`. Do not repeatedly rebuild; rebuilding does not release a port.

### n8n reports `Database is not ready` or an old container-name conflict

Run commands from the repository root. Preserve the named volume, remove only the stopped/conflicting container if necessary, and recreate n8n:

```bash
docker compose ps -a
docker compose logs --tail=100 n8n
docker compose up -d --force-recreate n8n
```

Do not delete the volume or change `N8N_ENCRYPTION_KEY`.

### Workflow returns `Configured brand_id does not exist`

The UUID in `IG_BRANDS_JSON` must exactly match an existing `public.brands.id`. Recreating containers is required after changing root `.env`:

```bash
docker compose up -d --force-recreate ml-service
```

Then verify the container received the new configuration without printing tokens:

```bash
docker compose exec ml-service python -c "import os,json; print([x.get('brand_id') for x in json.loads(os.environ.get('IG_BRANDS_JSON','[]'))])"
```

### Graph API returns 401/403, invalid app ID, or token errors

- Generate a token for the correct Meta app/user and required permissions.
- Confirm the Instagram Professional account ID, not a Page ID or username.
- Replace the token server-side, recreate the ML container, and run the health branch first.
- Rotate any token that was printed or shared. Never include it in bug reports.

### Sync result is `partial`

Inspect each `results[].sync` and `results[].train` object plus sanitized ML logs:

```bash
docker compose logs --tail=250 ml-service
```

Fix only the failed brand/token/data condition, then manually rerun the idempotent workflow. A `partial` response is intentionally treated as failure by n8n.

### Prediction says no trained model is available

Verify the brand has either a promoted personal model or a promoted niche model. Sync enough mature, varied data, retrain, and review model quality. Minimum counts are 200 per personal brand or 30 pooled per niche; counts alone do not guarantee all three classes or baseline improvement.

### Preflight says the model used different training/preprocessing source

The running code changed after the model was trained. Run the verified sync/retrain workflow again, export fresh evidence, and rerun preflight. Do not reuse an old artifact after feature, format-eligibility, or training-code changes.

### Gemini helpers return 501

This is expected when `LLM_API_KEY` is empty. ML prediction and manual Creative Brief entry still work. Add a valid server-side key and recreate the frontend container to enable optional helpers.

### Frontend build warns about Supabase in Edge Runtime

Next.js may emit an Edge-runtime compatibility warning from the Supabase dependency while still compiling successfully. Treat a successful build and passing CI as the current contract; re-evaluate the dependency/middleware implementation during future framework upgrades.

### npm deprecation warnings during installation

Transitive packages may print deprecation notices even when `npm audit` reports no vulnerability. Do not blindly upgrade major framework/tooling versions before the presentation; update deliberately on a branch, rerun lint/type/build, and verify the UI.

## Known limitations and future work

Realistic extensions intentionally outside the present bachelor's-thesis scope:

1. Public Meta OAuth onboarding, encrypted per-tenant token storage, long-lived token exchange, refresh/reconnect flow, and automatic account discovery.
2. Fixed-horizon engagement snapshots (for example 24-hour and 7-day ER) so recency and trend comparisons have equal exposure.
3. Multimodal image/video/audio feature extraction with consent, storage, annotation, and time-aware validation.
4. Versioned external trend data for topics, formats, and audio; trend features must be backtestable and kept separate from brand identity.
5. Calibrated class probabilities, uncertainty intervals, and larger multi-brand validation datasets.
6. Durable job queue/workers, retry policies, dead-letter handling, concurrency control, and horizontal model-serving cache strategy.
7. Database connection pooling, scheduled artifact retention, observability dashboards, alerts, and service-level objectives.
8. Self-service account management, invitations/roles, password recovery, and collaborative optimistic locking.
9. Automatic publishing and webhook-driven publication reconciliation after Meta product/permission review.
10. Cloud deployment infrastructure, managed secrets, disaster recovery, data retention controls, and privacy/export/deletion workflows.

These improvements should not be simulated with placeholder data. Each requires a new data contract, security review, tests, and evidence appropriate to its claim.

## License

The root `LICENSE` retains all rights and permits academic review/thesis evaluation only. This conservative default avoids granting public redistribution rights without an explicit owner decision. Replace it only after the owner deliberately chooses and reviews an open-source or commercial license.

---

**Repository:** <https://github.com/WincentCP/FAIV-Predict>  
**Documentation status:** verified against the implementation on 2026-07-13.
