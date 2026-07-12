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
| Brands and cohorts | `GET/POST /api/brands` | `brands`; training-eligible post counts from `posts` | Brand rows require `owner_id = auth.uid()`. Counts include only posts that are mature, `source = instagram_graph`, linked by immutable media ID, and mapped to a model-supported format; Feed/unknown video does not inflate model maturity. A new workspace starts disconnected and with no trained model. |
| Instagram connection health | `GET /api/instagram-health` → FastAPI | Meta Graph `/me` plus the latest verified `posts.synced_at` | The BFF sends only owned brand UUIDs. FastAPI filters the credential bindings before any database or Graph request. Empty ownership performs no work. |
| Brand Performance Snapshot | `GET /api/brand-patterns` → FastAPI `/brand/patterns` | Mature `source = instagram_graph` rows for one selected brand, linked by immutable media ID | The BFF authenticates the user and proves `brands.owner_id = auth.uid()` before using the private ML route. The response contains aggregate `n`, median, Q1/Q3, evidence levels, freshness, recent publishing mix, and counts of verified rows excluded because their format is not modeled; it never returns historical captions or media IDs. It is brand-scoped even when prediction uses a niche model. |
| Compose signals | Local deterministic parsing | The user's current caption, format, and schedule | These are draft-derived UI signals, not historical claims. CTA parsing mirrors the trained model feature contract. |
| Prediction verdict and explanations | `POST /api/predict` → FastAPI | Certified model bundle from Supabase Storage plus the submitted draft | The BFF proves brand ownership and supplies `created_by`. Each immutable result records the model ID, model version, feature-schema hash, raw-input hash, optional-time status, and supersession lineage. Feature importance is global evidence; sensitivity scenarios are non-causal model simulations. |
| Prediction history | `GET/PATCH/DELETE /api/history` | `predictions` joined to `brands` | Every operation requires an owned `brand_id` and `created_by = auth.uid()`. Scored inputs and outputs cannot be edited. Delete soft-archives the row; restore and lifecycle changes are audited. “Actual” appears only when `actual_source = instagram_media_id`. |
| Insights post list | `GET /api/instagram-posts` → FastAPI | Meta Graph media plus verified stored post observations | The BFF supplies one owned brand ID. Stored comparisons match immutable media IDs and only verified `source = instagram_graph` rows. Meta `media_product_type` distinguishes Reels from Feed video; unknown video is never relabeled as Reels. Live reactions and media preview come from Graph; captured engagement rate and tier context come from the corresponding sync observation. |
| Insights post metrics | `POST /api/instagram-post-insights` → FastAPI | Meta Graph lifetime insights for the selected owned media ID | The BFF verifies the brand before forwarding. Unsupported or unavailable Meta metrics remain unavailable; they are not estimated. |
| Model Health | `GET /api/models`, `GET/POST /api/train` | `models`, `model_retrain_jobs`, ML training pipeline | Personal models are restricted to owned brand IDs and cohort models to owned cohorts. Accuracy is the stored held-out validation value, not live monitoring. Training calls are authenticated service-to-service. |
| Thesis model evidence | `python -m app.thesis_evidence` inside `ml-service` | Latest application-append-only `models.metrics` row per configured account/cohort | Exports baseline/candidate metrics, confusion matrix, class distributions, dataset/code SHA-256 and data window. Captions, database URLs, tokens and model binaries are never exported. Privileged database administrators can still alter these rows; the prototype does not claim tamper-proof storage. |
| Calendar | `GET/POST/PATCH/DELETE /api/calendar` | `calendar_entries` | Every row is filtered by `owner_id = auth.uid()`. `source` is `manual` or `import`. Prediction history is not implicitly copied into Calendar. |
| Calendar import | Client parser and reviewed mapping → `POST /api/calendar` | User-selected CSV/XLSX file, then `calendar_entries` | Nothing is written before mapping review. Unknown content types become `Unspecified` with a warning; optional fields do not invalidate a row. The API caps a batch at 500 rows. |
| Calendar export | Current authenticated Calendar state | The owned `calendar_entries` already returned by the API | CSV/XLSX/PDF are projections of the filtered workspace state; export creates no database records. |
| AI cohort suggestion | `POST /api/classify` | The authenticated user's bounded description plus configured Gemini response | A suggestion is advisory and must be confirmed. The BFF requires a valid session, keeps the key in a server-side header, bounds and validates the provider response, and reports unavailable without Gemini; there is no fabricated classifier response. |
| AI caption/concept tools | `POST /api/refine-caption`, `POST /api/analyze-concept` | User input, a safe aggregate Brand Performance Snapshot, and configured Gemini response | Optional planning assistance only. The BFF authenticates the user and proves ownership of `brand_id`; no raw historical captions or media IDs are supplied as context. Output is bound to the submitted input snapshot and becomes stale when the brief, caption, format, or brand changes. It does not change a prediction until the user replaces the draft and re-analyzes it. |

## Descriptive-evidence and trend boundary

The Brand Performance Snapshot is deliberately separate from prediction
evidence. It summarizes observed associations for one brand using robust
descriptive statistics. Its `limited`, `exploratory`, and `directional` labels
are sample-size UX guards, not statistical-significance or causal-preference
claims.

Freshness is derived from verified post/sync timestamps. The recent 90-day
section describes only the brand's publishing mix. It does not compare recent
and older ER because `posts.er` is cumulative at the latest synchronization and
is therefore confounded by post age. No audience-demographics source,
multimodal media analysis, reviewed content-pillar taxonomy, seasonal-event
source, or external trend feed is connected. Those dimensions must remain
explicitly unavailable instead of being inferred from Gemini text.

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
3. Apply `supabase/migrations/202607120003_brand_patterns_and_media_product.sql`
   before deploying the Brand Performance Snapshot. Run a verified Graph sync
   afterward so existing video rows receive Meta product classification; do not
   present pre-backfill video rows as Reels.
4. Run `bash scripts/verify_env.sh`; the ownership, provenance, Storage, and
   credential checks must pass or produce only intentional optional-integration warnings.
5. Confirm every production brand has an explicit owner assignment.
6. Configure `IG_BRANDS_JSON` with existing owned brand UUIDs; never bind a
   token by display-name inference.
   Set `IG_SYNC_POST_LIMIT` between 1 and 1000 when deeper account history is
   required; the default is 500 and the sync result records whether additional
   Graph history was truncated by that cap. The cap applies only to one fetch;
   training uses all eligible verified rows accumulated in the database, and
   lowering the cap never deletes older synchronized rows.
7. Run frontend lint, TypeScript, production build, the ML test suite, and `python scripts/verify_thesis_readiness.py`.
8. Confirm n8n blocks `$env`, both HTTP nodes use the encrypted Header Auth credential, and the imported workflow remains inactive until both branches pass manually.
9. Retrain final thesis models with evaluation contract `faiv-thesis-v2` and export the baselines/comparators, temporal evaluation, scientific status, confusion matrix, per-class and ordinal metrics, data window, and fingerprints.
10. Run `scripts/thesis_preflight.ps1`; it must confirm each final model's
    recorded training-code SHA-256 matches the currently running ML container.
    A mismatch means the model predates deployed training semantics and must be
    retrained. Then record A01–A12 from `docs/THESIS_TEST_REPORT.md`.
11. Verify empty accounts show empty states on Dashboard, History, Insights, and
   Calendar before connecting real integrations.

Reports, Settings, notifications, and user-management pages are intentionally
not represented as product surfaces in this thesis release. There is no real
data contract or operator workflow behind them; adding decorative navigation
would create false completeness. Calendar provides presentation-ready PDF and
editable CSV/XLSX exports, while account provisioning remains an administrator
operation in Supabase Auth.
