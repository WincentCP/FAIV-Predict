# Data provenance and tenant boundaries

This document is the release-time trace for every data-bearing product surface.
The core rule is simple: a browser session can read only records owned by its
authenticated Supabase user, while shared cohort models may be read only when
the user owns a brand in that cohort. UI code must render an explicit loading,
error, empty, or unavailable state; it must never substitute example records.

## Surface-to-source map

| Product surface | Browser/BFF source | Authoritative origin | Ownership/provenance rule |
| --- | --- | --- | --- |
| Login and account menu | Supabase Auth session | `auth.users` | The session user only; no locally invented profile. |
| Dashboard workspace counts | `GET /api/dashboard` | `brands`, `predictions`, `models` | Brands require `owner_id = auth.uid()`. Predictions require both an owned `brand_id` and `created_by = auth.uid()`. Personal models are restricted to owned brand IDs; cohort models to cohorts represented by owned brands. |
| Dashboard recent predictions | `GET /api/dashboard` | `predictions` joined to `brands` | Same dual prediction ownership check. A missing confidence is shown as unavailable, never zero. |
| Brands and cohorts | `GET/POST /api/brands` | `brands`; verified post counts from `posts` | Brand rows require `owner_id = auth.uid()`. Maturity counts include only `source = instagram_graph` rows with an immutable `instagram_media_id`. A new workspace starts disconnected and with no trained model. |
| Instagram connection health | `GET /api/instagram-health` → FastAPI | Meta Graph `/me` plus the latest verified `posts.synced_at` | The BFF sends only owned brand UUIDs. FastAPI filters the credential bindings before any database or Graph request. Empty ownership performs no work. |
| Compose signals | Local deterministic parsing | The user's current caption, format, and schedule | These are draft-derived UI signals, not historical claims. CTA parsing mirrors the trained model feature contract. |
| Prediction verdict and explanations | `POST /api/predict` → FastAPI | Certified model bundle from Supabase Storage plus the submitted draft | The BFF proves brand ownership and supplies `created_by`. Each immutable result records the model ID, model version, feature-schema hash, raw-input hash, optional-time status, and supersession lineage. Feature importance is global evidence; sensitivity scenarios are non-causal model simulations. |
| Prediction history | `GET/PATCH/DELETE /api/history` | `predictions` joined to `brands` | Every operation requires an owned `brand_id` and `created_by = auth.uid()`. Scored inputs and outputs cannot be edited. Delete soft-archives the row; restore and lifecycle changes are audited. “Actual” appears only when `actual_source = instagram_media_id`. |
| Insights post list | `GET /api/instagram-posts` → FastAPI | Meta Graph media plus verified stored post observations | The BFF supplies one owned brand ID. Stored comparisons match immutable media IDs and only verified `source = instagram_graph` rows. Live reactions and media preview come from Graph; captured engagement rate and tier context come from the corresponding sync observation. |
| Insights post metrics | `POST /api/instagram-post-insights` → FastAPI | Meta Graph lifetime insights for the selected owned media ID | The BFF verifies the brand before forwarding. Unsupported or unavailable Meta metrics remain unavailable; they are not estimated. |
| Model Health | `GET /api/models`, `GET/POST /api/train` | `models`, `model_retrain_jobs`, ML training pipeline | Personal models are restricted to owned brand IDs and cohort models to owned cohorts. Accuracy is the stored held-out validation value, not live monitoring. Training calls are authenticated service-to-service. |
| Calendar | `GET/POST/PATCH/DELETE /api/calendar` | `calendar_entries` | Every row is filtered by `owner_id = auth.uid()`. `source` is `manual` or `import`. Prediction history is not implicitly copied into Calendar. |
| Calendar import | Client parser and reviewed mapping → `POST /api/calendar` | User-selected CSV/XLSX file, then `calendar_entries` | Nothing is written before mapping review. Unknown content types become `Unspecified` with a warning; optional fields do not invalidate a row. The API caps a batch at 500 rows. |
| Calendar export | Current authenticated Calendar state | The owned `calendar_entries` already returned by the API | CSV/XLSX/PDF are projections of the filtered workspace state; export creates no database records. |
| AI cohort suggestion | `POST /api/classify` | The user's description plus configured Gemini response | A suggestion is advisory and must be confirmed. Without Gemini, the endpoint reports unavailable; there is no fabricated classifier response. |
| AI caption/concept tools | `POST /api/refine-caption`, `POST /api/analyze-concept` | User input plus configured Gemini response | Optional drafting assistance only. It does not change a prediction until the user replaces the draft and re-analyzes it. |

## Quarantine and deletion policy

- Legacy brands with no verified owner remain unowned. The migration never
  guesses an owner, even when the Auth project currently has one user.
- Legacy posts without both Graph source and immutable media ID do not count
  toward model maturity, analytics comparisons, or training.
- Legacy predictions without `created_by` remain invisible to user history and
  dashboard aggregates. They are not auto-assigned.
- No seed script or demo dataset is part of the runtime. Unknown legacy data is
  quarantined instead of automatically deleted so an administrator can audit it.

## Deployment gates

Before a release, all gates below must pass:

1. Apply `supabase/migrations/202607110001_user_data_ownership_and_calendar.sql`.
2. Apply `supabase/migrations/202607110002_prediction_lifecycle.sql` before deploying the matching frontend and ML service.
3. Run `bash scripts/verify_env.sh`; the ownership, provenance, Storage, and
   credential checks must pass or produce only intentional optional-integration warnings.
4. Confirm every production brand has an explicit owner assignment.
5. Configure `IG_BRANDS_JSON` with existing owned brand UUIDs; never bind a
   token by display-name inference.
6. Run frontend lint, TypeScript, production build, and the ML test suite.
7. Verify empty accounts show empty states on Dashboard, History, Insights, and
   Calendar before connecting real integrations.

Reports, Settings, notifications, and user-management pages are intentionally
not represented as product surfaces in this thesis release. There is no real
data contract or operator workflow behind them; adding decorative navigation
would create false completeness. Calendar provides presentation-ready PDF and
editable CSV/XLSX exports, while account provisioning remains an administrator
operation in Supabase Auth.
