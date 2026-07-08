# AGENTS.md

## Cursor Cloud specific instructions

FAIV Predict is a two-service app plus a hosted Supabase backend:

- **frontend** (`frontend/`) — Next.js 14 (App Router). Dev server on port **3000**. Also hosts BFF proxy routes under `frontend/app/api/*` that forward to the ML service and to Supabase.
- **ml-service** (`ml-service/`) — FastAPI + scikit-learn inference engine. Port **8000**. Endpoints: `/predict`, `/suggest`, `/train`, `/sync` (Swagger at `/docs`).
- **Supabase** (hosted Postgres + Auth + Storage) — required for auth and for brand/history/dashboard/model data. No local Supabase container ships with the repo.

Standard commands live in `frontend/package.json` (`dev`/`build`/`lint`/`start`) and `ml-service/Dockerfile`. The startup update script installs deps and creates the local dev env files (see below).

### Running the services
- ML service (Python deps live in `ml-service/venv`, created by the update script):
  `cd ml-service && ./venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000`
- Frontend: `npm run dev --prefix frontend` (or `cd frontend && npm run dev`).
- Start the ML service first; the frontend's `/api/predict` proxy targets `FASTAPI_URL` (default `http://127.0.0.1:8000`).

### Non-obvious caveats
- **Env files are required and gitignored.** The auth middleware calls `createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, ...)`, so with those vars unset the middleware throws on *every* route (500s everywhere, including `/`). `frontend/.env.local` (needs `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `FASTAPI_URL`) and `ml-service/.env` are created by the update script with dummy/local values; they are never committed. Replace the dummy Supabase values with a real project to exercise auth/DB features.
- **Auth bypass for local demos:** dashboard routes (`/predict`, `/dashboard`, `/calendar`, `/history`, `/model-health`, `/niches`, `/suggest`) redirect to `/` unless a Supabase user session exists OR a `sb-simulated-login=true` cookie is set. With only dummy Supabase creds, set the cookie in the browser DevTools console: `document.cookie = "sb-simulated-login=true; path=/"`, then navigate to the route.
- **ML service works fully offline.** With no `DATABASE_URL`/`SUPABASE_*`, `ModelLoader` generates a mock RandomForest fallback model, so `/predict`, `/suggest`, and `/train` all return valid results without any database.
- **Supabase-backed BFF routes fail without a real project.** `/api/brands`, `/api/history`, `/api/dashboard`, `/api/models` return errors without valid Supabase creds. Consequence: the `/predict` page brand selector is empty and its "Analyze Post" button stays disabled (it requires a selected brand). The prediction engine itself is still testable directly via the ML service `POST /predict` or the frontend BFF `POST /api/predict` (neither requires a brand).
- **Secret formats matter (non-obvious).** The frontend only needs the Supabase project URL + anon/publishable key (used via `supabase-js` REST). The ML service's `DATABASE_URL` must be a real Postgres DSN (`postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres` or the pooled `...pooler.supabase.com` string) — the project `https://` URL is NOT a valid DSN and `psycopg2` will reject it, silently forcing `/predict` onto its fallback model and disabling prediction logging / training registration / `/sync`. `SUPABASE_KEY` (for model Storage and any server-side writes) should be the service-role key, not the publishable key.
- **RLS is enabled on the tables.** Reads via the anon key succeed but writes (e.g. `POST /api/brands`) are rejected with "row violates row-level security policy" unless performed with an authenticated user session whose RLS policy permits it (or the service-role key). Note the repo ships no RLS policies and the schema has no per-user ownership column, so write policies must be configured in the Supabase project. Auth also has `mailer_autoconfirm` off, so new signups require email confirmation before they can log in.
- **Lint is interactive on first run.** `npm run lint` (`next lint`) prompts to configure ESLint because the repo ships no `.eslintrc*` (the flat `eslint.config.js` is an unused leftover that references Vite plugins not in `package.json`). Choosing "Strict" writes `.eslintrc.json` extending `next/core-web-vitals`. Note there is a pre-existing lint error (`react/no-unescaped-entities` in `components/CaptionIntel.tsx`).
- **Tests:** `ml-service` has `pytest` tests in `ml-service/tests/` (run `./venv/bin/python -m pytest` from `ml-service/`). The frontend has no test framework configured.
- **Optional integrations:** Google Gemini (`LLM_API_KEY`), Instagram Graph API (sync tokens), and n8n are all optional; the app degrades gracefully without them.
