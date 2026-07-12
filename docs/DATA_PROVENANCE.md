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
| Instagram connection health | `GET /api/instagram-health` → FastAPI | Operator-configured `IG_BRANDS_JSON`, Meta Graph `/me`, and latest verified `posts.synced_at` | The thesis does not implement public OAuth. An operator binds an immutable Instagram account ID and secret to an existing brand; the BFF sends only owned brand UUIDs and FastAPI filters bindings before Graph access. The browser never receives the Meta credential. |
| Brand Performance Snapshot | `GET /api/brand-patterns` → FastAPI `/brand/patterns` | Mature `source = instagram_graph` rows for one selected brand, linked by immutable media ID | The BFF authenticates the user and proves `brands.owner_id = auth.uid()` before using the private ML route. The response contains aggregate `n`, median, Q1/Q3, evidence levels, freshness, recent publishing mix, and counts of verified rows excluded because their format is not modeled; it never returns historical captions or media IDs. It is brand-scoped even when prediction uses a niche model. |
| Compose signals | Local deterministic parsing | The user's current caption, format, and schedule | These are draft-derived UI signals, not historical claims. CTA parsing mirrors the trained model feature contract. |
| Prediction verdict and explanations | `POST /api/predict` → FastAPI | Certified model bundle from Supabase Storage plus the submitted draft | The BFF proves brand ownership and supplies `created_by`. Each immutable result records the model ID, model version, feature-schema hash, raw-input hash, optional-time status, and supersession lineage. Feature importance is global evidence; sensitivity scenarios are non-causal model simulations. |
| Prediction history | `GET/PATCH/DELETE /api/history` | `predictions` joined to `brands` and verified publication linkage | Every operation requires an owned `brand_id` and `created_by = auth.uid()`. Scored inputs and outputs cannot be edited. Delete soft-archives the row; restore and lifecycle changes are audited. Observed ER is shown only after an immutable media-ID link and mature verified sync. The current thesis rejects all new `actual_class` derivation and exposes continuous ER only. |
| Insights post list | `GET /api/instagram-posts` → FastAPI | Meta Graph media plus verified stored post observations | The BFF supplies one owned brand ID. Stored comparisons match immutable media IDs and only verified `source = instagram_graph` rows. Meta `media_product_type` distinguishes Reels from Feed video; unknown video is never relabeled as Reels. Live reactions and media preview come from Graph; captured engagement rate and tier context come from the corresponding sync observation. |
| Insights post metrics | `POST /api/instagram-post-insights` → FastAPI | Meta Graph lifetime insights for the selected owned media ID | The BFF verifies the brand before forwarding. Unsupported or unavailable Meta metrics remain unavailable; they are not estimated. |
| Model Health | `GET /api/models`, `GET/POST /api/train` | `models`, `model_retrain_jobs`, ML training pipeline | Personal models are restricted to owned brand IDs and cohort models to owned cohorts. Accuracy is the stored held-out validation value, not live monitoring. Training calls are authenticated service-to-service. |
| Thesis model evidence | `python -m app.thesis_evidence` inside `ml-service` | Latest application-append-only `models.metrics` row per configured account/cohort | Exports baseline/candidate metrics, confusion matrix, class distributions, dataset/code SHA-256 and data window. Captions, database URLs, tokens and model binaries are never exported. Privileged database administrators can still alter these rows; the prototype does not claim tamper-proof storage. |
| Content Plan | Authenticated Calendar/Content Plan BFF routes | `calendar_entries`, immutable prediction reference, and verified publication linkage | Every plan is filtered by `owner_id = auth.uid()`. `source` is `manual` or `import`. Opening Predict passes a plan snapshot explicitly; a returned prediction can be attached only when owner and brand match. Prediction inputs/outputs are never copied back as mutable evidence. |
| Publication confirmation | `POST /api/publication-links` | `prediction_publications` joined to one verified `posts` row | Requires an authenticated same-owner prediction, a Graph-sourced post under the same brand, and an explicit confirmation flag. Database uniqueness allows at most one post per prediction and one prediction per post; identity columns cannot be updated after insertion. |
| Observed outcome | Content Plan and History projections | Linked mature `posts.er`, `posts.synced_at`, `predictions.actual_er`, and lifecycle events | The database accepts `actual_source = instagram_media_id` only when `actual_er` exactly matches the linked post and the post is at least seven days old. This flow does not derive `actual_class`; it remains unavailable. |
| Calendar import | Client parser and reviewed mapping → `POST /api/calendar` | User-selected CSV/XLSX file, then `calendar_entries` | Nothing is written before mapping review. Unknown content types become `Unspecified` with a warning; optional fields do not invalidate a row. The API caps a batch at 500 rows. |
| Calendar export | Current authenticated Calendar state | The owned `calendar_entries` already returned by the API | CSV/XLSX/PDF are projections of the filtered workspace state; export creates no database records. |
| AI cohort suggestion | `POST /api/classify` | The authenticated user's bounded description plus configured Gemini response | A suggestion is advisory and must be confirmed. The BFF requires a valid session, keeps the key in a server-side header, bounds and validates the provider response, and reports unavailable without Gemini; there is no fabricated classifier response. |
| AI caption/concept tools | `POST /api/refine-caption`, `POST /api/analyze-concept` | User input, a safe aggregate Brand Performance Snapshot, and configured Gemini response | Optional planning assistance only. The BFF authenticates the user and proves ownership of `brand_id`; no raw historical captions or media IDs are supplied as context. Output is bound to the submitted input snapshot and becomes stale when the brief, caption, format, or brand changes. It does not change a prediction until the user replaces the draft and re-analyzes it. |

## Content-to-outcome identity boundary

The supported thesis lifecycle is:

1. an authenticated user creates or imports an owned Content Plan;
2. that plan opens Predict with explicit brand, format, caption, schedule, and
   optional time values;
3. the saved immutable prediction is attached back to the same-owner,
   same-brand plan;
4. after manual publication, one verified Instagram media ID is deliberately
   linked to the plan/prediction;
5. a Graph sync resolves that immutable ID under the configured brand account;
6. once the post is at least seven complete days old, the UI may show the
   observed cumulative ER and observation provenance.

Caption text, publication order, brand display name, and approximate timestamps
are not publication identity. They may support a read-only candidate hint, but
cannot write a link or an outcome. Database constraints/triggers reject a media
identity already linked inconsistently, a prediction belonging to another
owner or brand, or a later attempt to rewrite the linked immutable identity.
The thesis UI has no relink/delete action; an incorrect confirmation requires
an administrator-reviewed correction outside the normal workflow with evidence
retained. A formal correction workflow is future work.
Successful links and observed/refreshed outcomes enter the lifecycle audit
history. Rejected requests return typed errors but are not a durable user-facing
lifecycle event in this thesis; production security telemetry remains future
work.

Observed ER is the primary realized value. Migration 004 deliberately rejects
all new or changed `actual_class` values for this flow, and the UI must say
“tier unavailable.” A future categorical outcome would require a new versioned
schema/migration plus proof that the original prediction model's recorded
P33/P67 thresholds are applied to an outcome produced by the same documented
maturity and denominator policy. It must never use a current brand median, a
newly retrained model, or ad hoc cutoffs.

## Instagram connection boundary

Instagram integration is operator-assisted in this thesis. An operator obtains
and rotates the Meta credential outside FAIV Predict, records the immutable
account-to-brand binding in `IG_BRANDS_JSON`, and verifies health. The first
verified sync persists `brands.instagram_account_id`; later mismatches are
rejected and authenticated users cannot edit that identity. Users may maintain
bounded `profile_summary` planning context. `brands.timezone` is persisted but
constrained to `Asia/Jakarta` in this thesis so training and inference use the
same WIB semantics; it is not a multi-timezone claim. Neither field is an OAuth
credential. The product
does not claim Meta Login, public OAuth consent, refresh-token lifecycle,
self-service onboarding, or direct publishing. A future SaaS release would need
Meta app review, an encrypted connection registry, scoped OAuth callback/state
validation, revocation and refresh handling, tenant admin consent, and deletion
procedures.

n8n only schedules connection health, Graph synchronization/reconciliation,
and retraining, then notifies operators. It does not choose which plan maps to a
post, create tenant data, bypass RLS, or define `actual_class`. The authenticated
BFF and database invariants remain authoritative.

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
4. Apply `supabase/migrations/202607120004_content_lifecycle_integration.sql`
   before deploying Content Plan/prediction/publication cohesion. This adds the
   immutable brand Instagram identity, `prediction_publications`, observed-ER
   validation, RLS, uniqueness guards, and lifecycle audit triggers.
5. Run `bash scripts/verify_env.sh`; the ownership, provenance, Storage, and
   credential checks must pass or produce only intentional optional-integration warnings.
6. Confirm every production brand has an explicit owner assignment.
7. Configure `IG_BRANDS_JSON` with existing owned brand UUIDs; never bind a
   token by display-name inference.
   Set `IG_SYNC_POST_LIMIT` between 1 and 1000 when deeper account history is
   required; the default is 500 and the sync result records whether additional
   Graph history was truncated by that cap. The cap applies only to one fetch;
   training uses all eligible verified rows accumulated in the database, and
   lowering the cap never deletes older synchronized rows.
8. Run frontend lint, TypeScript, production build, the ML test suite, and `python scripts/verify_thesis_readiness.py`.
9. Confirm n8n blocks `$env`, both HTTP nodes use the encrypted Header Auth credential, and the imported workflow remains inactive until both branches pass manually.
10. Retrain final thesis models with evaluation contract `faiv-thesis-v2` and export the baselines/comparators, temporal evaluation, scientific status, confusion matrix, per-class and ordinal metrics, data window, and fingerprints.
11. Run `scripts/thesis_preflight.ps1`; it must confirm each final model's
    recorded training-code SHA-256 matches the currently running ML container.
    A mismatch means the model predates deployed training semantics and must be
    retrained. Then record A01–A12 from `docs/THESIS_TEST_REPORT.md`.
12. Verify empty accounts show empty states on Dashboard, History, Insights, and
   Calendar before connecting real integrations.

Reports, Settings, notifications, and user-management pages are intentionally
not represented as product surfaces in this thesis release. There is no real
data contract or operator workflow behind them; adding decorative navigation
would create false completeness. Calendar provides presentation-ready PDF and
editable CSV/XLSX exports, while account provisioning remains an administrator
operation in Supabase Auth.
