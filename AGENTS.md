# AGENTS.md

## Cursor Cloud specific instructions

FAIV Predict is a two-service app plus a hosted Supabase backend:

- **frontend** (`frontend/`) — Next.js 14 (App Router). Dev server on port **3000**. Also hosts BFF proxy routes under `frontend/app/api/*` that forward to the ML service and to Supabase.
- **ml-service** (`ml-service/`) — FastAPI + scikit-learn inference engine. Port **8000**. Endpoints: `/predict`, `/suggest`, `/train`, `/train/{job_id}`, `/sync/now` (Swagger at `/docs`).
- **Supabase** (hosted Postgres + Auth + Storage) — required for auth and for brand/history/dashboard/model data. No local Supabase container ships with the repo.

Standard commands live in `frontend/package.json` (`dev`/`build`/`lint`/`start`) and `ml-service/Dockerfile`. The startup update script installs deps and creates the local dev env files (see below).

### Running the services
- ML service (Python deps live in `ml-service/venv`, created by the update script):
  `cd ml-service && ./venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000`
- Frontend: `npm run dev --prefix frontend` (or `cd frontend && npm run dev`).
- Start the ML service first; the frontend's `/api/predict` proxy targets `FASTAPI_URL` (default `http://127.0.0.1:8000`).

### Non-obvious caveats
- **Env files are required and gitignored.** `frontend/.env.local` (needs `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `FASTAPI_URL`) and `ml-service/.env` are created by the update script with dummy/local values; they are never committed. If the Supabase env vars are missing, the middleware treats every request as unauthenticated (dashboard routes redirect to `/`) instead of crashing — replace the dummy values with a real project to exercise auth/DB features.
- **Authentication is real.** There is no client-side bypass or simulated-login cookie. The login form is pre-filled with the development credentials (see `DESIGN.md`), which authenticate against the real Supabase Auth project. Without valid Supabase credentials, dashboard routes are unreachable.
- **The ML service does not fabricate results.** Without a `DATABASE_URL` (or without trained models), `/predict` returns an honest `503`, `/train/{job_id}` returns `503`, and only `/suggest` (deterministic TRE heuristics computed from the request itself) works offline. Training requires ≥ 30 real posts in the database.
- **Secret formats matter (non-obvious).** The frontend only needs the Supabase project URL + anon/publishable key (used via `supabase-js` REST). The ML service's `DATABASE_URL` must be a real Postgres DSN (`postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres` or the pooled `...pooler.supabase.com` string) — the project `https://` URL is NOT a valid DSN and `psycopg2` will reject it. `SUPABASE_KEY` (for model Storage and any server-side writes) should be the service-role key, not the publishable key.
- **RLS is enabled on the tables.** Reads via the anon key succeed but writes (e.g. `POST /api/brands`) are rejected with "row violates row-level security policy" unless performed with an authenticated user session whose RLS policy permits it (or the service-role key). Note the repo ships no RLS policies and the schema has no per-user ownership column, so write policies must be configured in the Supabase project. Auth also has `mailer_autoconfirm` off, so new signups require email confirmation before they can log in.
- **Lint**: `npm run lint` uses the committed `.eslintrc.json` (`next/core-web-vitals`) and runs non-interactively.
- **Tests:** `ml-service` has `pytest` tests in `ml-service/tests/` (run `./venv/bin/python -m pytest` from `ml-service/`). The frontend has no test framework configured; use `npm run lint` and `npx tsc --noEmit`.
- **Optional integrations:** Google Gemini (`LLM_API_KEY`, used by `/api/classify` and `/api/refine-caption`), Instagram Graph API (sync tokens), and n8n are all optional; the corresponding features report themselves unavailable without them instead of simulating output.
