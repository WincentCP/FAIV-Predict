# AGENTS.md

## Cursor Cloud specific instructions

FAIV Predict is a two-service app plus a hosted Supabase backend:

- **frontend** (`frontend/`) — Next.js 15 + React 19 (App Router). Dev server on port **3000**. Also hosts BFF proxy routes under `frontend/app/api/*` that forward to the ML service and to Supabase.
- **ml-service** (`ml-service/`) — FastAPI + scikit-learn inference engine. Port **8000**. Endpoints: `/predict`, `/train`, `/train/{job_id}`, `/instagram/health`, `/instagram/posts`, `/instagram/post-insights`, `/sync/now` (Swagger at `/docs`).
- **Supabase** (hosted Postgres + Auth + Storage) — required for auth and for brand/history/dashboard/model data. No local Supabase container ships with the repo.

Standard commands live in `frontend/package.json` (`dev`/`build`/`lint`/`start`) and `ml-service/Dockerfile`. The startup update script installs deps and creates the local dev env files (see below).

### Running the services
- ML service (Python deps live in `ml-service/venv`, created by the update script):
  `cd ml-service && ./venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000`
- Frontend: `npm run dev --prefix frontend` (or `cd frontend && npm run dev`).
- Start the ML service first; the frontend's `/api/predict` proxy targets `FASTAPI_URL` (default `http://127.0.0.1:8000`).

### Non-obvious caveats
- **Env files are required and gitignored.** `frontend/.env.local` needs `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `FASTAPI_URL`; `ml-service/.env` contains the private service credentials. They are never committed. If Supabase variables are missing, middleware fails closed and treats every request as unauthenticated.
- **Authentication is real.** There is no client-side bypass, simulated-login cookie, or pre-filled credential. Without valid Supabase credentials, dashboard routes are unreachable.
- **The ML service does not fabricate results.** Without a `DATABASE_URL` or a trained model, `/predict` returns an honest `503` and `/train/{job_id}` returns `503`. Shared-cohort training requires ≥ 30 pooled real posts; personal training requires ≥ 200 posts from that brand.
- **Training data requires lineage.** Only rows marked `source = instagram_graph` with an immutable `instagram_media_id` count toward samples, baselines, or model training. Sync upserts those rows and never clears post history; unknown legacy rows remain quarantined.
- **Secret formats matter (non-obvious).** The frontend only needs the Supabase project URL + anon/publishable key (used via `supabase-js` REST). The ML service's `DATABASE_URL` must be a real Postgres DSN (`postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres` or the pooled `...pooler.supabase.com` string) — the project `https://` URL is NOT a valid DSN and `psycopg2` will reject it. `SUPABASE_KEY` (for model Storage and any server-side writes) should be the service-role key, not the publishable key.
- **RLS is enabled on every user-facing table.** `brands.owner_id` is the ownership root; posts, predictions, personal models, retrain jobs, and calendar entries are restricted through it. Apply `supabase_schema.sql` or the committed migration before running this revision. Auth has `mailer_autoconfirm` off, so new signups require email confirmation before they can log in.
- **Lint**: `npm run lint` uses the committed `.eslintrc.json` (`next/core-web-vitals`) and runs non-interactively.
- **Tests:** `ml-service` has `pytest` tests in `ml-service/tests/` (run `./venv/bin/python -m pytest` from `ml-service/`). The frontend has no test framework configured; use `npm run lint` and `npx tsc --noEmit`.
- **Optional integrations:** Google Gemini (`LLM_API_KEY`, used by `/api/classify` and `/api/refine-caption`), Instagram Graph API (sync tokens), and n8n are all optional; the corresponding features report themselves unavailable without them instead of simulating output.
