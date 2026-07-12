# FAIV Predict bachelor-thesis verification report

Template revision date: 2026-07-12  
Final verification date: _Pending final-revision rehearsal_  
Scope: academic ML evidence, brand-scoped descriptive planning evidence, Content Plan-to-observed-outcome cohesion, API behavior, secure automation template, documentation consistency, and repeatable local demonstration.

## Current verdict

The repository contains the controls and evidence-generation paths required for a bachelor-thesis prototype. Final empirical model values and the complete UI demonstration must be regenerated once after deploying this revision because those results depend on the operator's private Supabase data and authenticated local browser session.

Passing automated tests establishes software behavior; it does not, by itself,
establish predictive validity. Predictive validity is assessed from the exported
model evidence below. Blank result cells are intentional and must never be
replaced with estimated or invented values.

Enterprise-scale queues, global high availability, public Instagram publishing, multi-region recovery, SSO, and formal SLA controls are explicitly outside this thesis acceptance scope.

Public Meta OAuth is also outside scope. The thesis evidence covers an
operator-assisted, brand-ID-bound Instagram connection configured outside the
browser; it must not be presented as self-service social-account onboarding.

## Automated evidence

| Gate | Command | Result on 2026-07-12 | Evidence covered |
| --- | --- | --- | --- |
| ML/API suite | `python -m pytest -q` in `ml-service` | PASS — 87 tests; one dependency deprecation warning | Authentication, validation, honest unavailable states, optional time, API successor request contract, maturity/provenance, immutable Instagram-account binding, publication reconciliation, continuous observed outcomes without derived `actual_class`, Meta product-type mapping, brand-pattern aggregation/privacy, comparison-eligibility and fixed-horizon trend guards, cursor-safe bounded historical pagination, fail-fast configuration and token-log redaction, authoritative retraining scope, terminal job state, safe atomic model caching, serving/evidence parity, feature parity, three-class and promotion gates, richer metrics/comparators, bounded rejection diagnostics, evaluation artifact and safe exporter. Real Supabase trigger/RLS behavior remains in A03/A06/A08. |
| Python static quality | `ruff check app tests` in `ml-service` | PASS | Unused imports, undefined names, syntax errors, and standard Python quality rules; narrow per-file exceptions preserve the submitted training-source fingerprint and the test bootstrap order. |
| Repository contract | `python scripts/verify_thesis_readiness.py` | PASS on current revision | Secure n8n template, blocked `$env`, Content Plan/publication cohesion, documentation alignment, and required thesis artifacts |
| Thesis-machine preflight | `powershell -ExecutionPolicy Bypass -File .\scripts\thesis_preflight.ps1` | Required after final sync/retrain | Container health, endpoint readiness, n8n isolation, migrations 003/004 schema, complete model evidence, and exact match between each model's recorded training-code SHA-256 and the currently running preprocessing/training source |
| Workflow JSON | `python -m json.tool n8n/workflow_sync_retrain.json` | PASS | JSON syntax only; Docker n8n import/node/runtime compatibility remains part of A09–A10 rehearsal |
| Frontend compile gates | GitHub Actions: lint, TypeScript, production build | Required on every `main` push | Full repository frontend compilation |
| Dependency gates | `npm audit --audit-level=moderate` in GitHub Actions | Required on every `main` push | Known moderate-or-higher npm advisories |

The only local Python warning was a Starlette deprecation notice inside the test framework dependency; no application test failed.

## Academic ML contract

Every newly trained model now persists:

- chronological 80:20 split;
- P33/P67 thresholds calculated only on training rows;
- majority-class `DummyClassifier` baseline;
- candidate and baseline accuracy;
- balanced accuracy;
- macro and weighted precision, recall, and F1;
- ordinal mean absolute error and quadratic weighted Cohen's kappa;
- per-class precision, recall, F1, and support;
- fixed `LOW`, `AVERAGE`, `HIGH` confusion matrix;
- majority-class and Logistic Regression comparator results;
- expanding-window temporal-validation summaries calculated within the oldest
  80%, leaving the newest 20% as the final holdout;
- balanced-accuracy permutation importance on the final holdout as a
  complementary global feature-reliance diagnostic;
- train/test class distributions;
- exact model parameters and random seed;
- collision-resistant model version and dependency/runtime evidence;
- baseline-relative operational promotion decision (rejected candidates do not replace the active model);
- separate scientific gate and `validated`/`exploratory` evaluation status;
- empirical posting-hour support for provisional predictions;
- verified-post count and data time window;
- seven-day minimum post-age gate and cumulative-observation policy;
- SHA-256 of the exact identity/label/feature dataset manifest;
- SHA-256 of the training and preprocessing source;
- versioned `faiv-thesis-v2` evaluation contract.

Raw captions, connection strings, Instagram tokens, and service secrets are excluded from evaluation evidence.

## Content lifecycle evidence contract

The cohesive thesis path is Content Plan → immutable Prediction → deliberately
verified Instagram publication identity → mature observed ER. Acceptance
evidence must prove:

- plan, prediction, and publication references have the same owner and brand;
- the publication identity is the immutable Instagram media ID, not caption,
  display name, posting order, or approximate timestamp;
- a conflicting or duplicate identity is rejected and the original link is not
  silently rewritten;
- changing model-used plan inputs preserves the scored snapshot and marks the
  relevant prediction stale;
- an unlinked or under-seven-day post has no realized outcome;
- a mature verified link may expose observed cumulative ER and observation
  provenance; and
- migration 004 rejects every new/changed `actual_class`; this thesis exposes
  continuous ER only. A future tier requires a new versioned schema/migration
  and a validated original-model threshold/outcome contract.

n8n evidence should show scheduling of health, sync/reconciliation, and
retraining. It is not evidence that n8n chose the publication identity or
authorized the tenant; those invariants belong to the BFF/database.

## Brand Performance Snapshot evidence contract

The pre-prediction snapshot is tested and demonstrated separately from ML
validity. It uses only mature, verified Instagram Graph rows for the selected
brand and returns aggregate sample counts, median cumulative ER, first/third
quartiles, evidence level, freshness, recent publishing mix, and transparent
counts of unmodeled formats excluded from comparisons. Historical captions and
media IDs are not returned by this endpoint.

Interpret its evidence levels only as UX guards:

- fewer than 5 observations: limited and not highlighted;
- 5–14: exploratory;
- 15 or more: directional;
- at least 20 total eligible posts and two eligible groups before naming a
  highest-observed group.

These values are not statistical-significance thresholds and do not establish
causality or audience preference. The test/demo must also show that demographics,
content pillars, visual/video style, hooks/storytelling, seasonality, and
external trends remain explicitly not measured. Recent publishing mix must not
be described as a recent performance trend because cumulative ER is confounded
by post age.

After rebuilding and running the final retraining, export the actual private-data results for the thesis appendix:

```powershell
docker compose exec -T ml-service python -m app.thesis_evidence --format markdown | Out-File -Encoding utf8 .\docs\FINAL_MODEL_EVIDENCE.md
```

`FINAL_MODEL_EVIDENCE.md` may be retained locally if brand/model details should not be published. Review it before committing.

## Final empirical model assessment

Complete one row per exported model. Copy values directly from
`FINAL_MODEL_EVIDENCE.md`; do not calculate them from screenshots or round them
selectively. Attach the exported report as an appendix or retain it in the
private evidence bundle when brand details cannot be published.

| Model scope/name | Version | Train N | Test N | Test support L/A/H | RF accuracy | Dummy accuracy | Logistic accuracy | Macro F1 | Balanced accuracy | Ordinal MAE | Quadratic weighted kappa | Temporal-fold summary | Scientific status | Evidence file/page |
| --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| _Complete after final retraining_ | _Pending_ | — | — | —/—/— | — | — | — | — | — | — | — | _Pending_ | _Pending_ | _Pending_ |
| _Complete after final retraining_ | _Pending_ | — | — | —/—/— | — | — | — | — | — | — | — | _Pending_ | _Pending_ | _Pending_ |

Interpretation rule:

- report `exploratory` when any class is absent from the held-out test or recall
  is zero for any represented class;
- never reinterpret operational promotion as scientific validation;
- discuss class support and confusion matrix before drawing conclusions from
  aggregate accuracy;
- state the outcome as a relative cumulative likes-and-comments engagement
  tier using a first-observation follower proxy, not as exact seven-day
  engagement or causal uplift;
- if Random Forest does not consistently improve on the simpler comparators,
  report that honestly and narrow the conclusion to artifact feasibility.

## Historical operator observations

The operator reported and showed the following on the thesis machine before this revision:

- Supabase migrations applied and Advisor findings addressed;
- frontend, ML service, and n8n containers running with healthy status;
- Instagram bindings resolving to Bison Gym and Lasence Bakeshop;
- n8n sync/retrain workflow completing successfully;
- n8n credentials surviving container recreation;
- `N8N_BLOCK_ENV_ACCESS_IN_NODE=true` deployment with workflow secrets moved to encrypted Credentials.

These observations are useful setup history but do not replace the dated final
rehearsal below. The final runbook must prove that the repository, rebuilt image,
evaluation contract, and private integrations work together at the revision
submitted for examination.

## Final acceptance scenarios

Record `PASS`, `FAIL`, or `BLOCKED`, the execution time, and at least one exact
evidence reference for every scenario. Suggested filenames are
`A01-docker-health.png` through `A12-runtime-security.txt`. n8n evidence must
include its execution ID and completion timestamp. Database evidence may use a
redacted query result. Never capture passwords, tokens, cookies, connection
strings, credential values, or `.env` contents.

| ID | Scenario | Expected result | Status | Date/time (WIB) | Screenshot, log, query, or execution ID | Observed result / deviation |
| --- | --- | --- | --- | --- | --- | --- |
| A01 | Start Docker stack | frontend, ml-service, and n8n become healthy | _Pending_ | _Pending_ | _Pending_ | _Pending_ |
| A02 | Login | valid thesis user reaches Dashboard; invalid credentials fail safely | _Pending_ | _Pending_ | _Pending_ | _Pending_ |
| A03 | Brand ownership | only brand records owned by the authenticated thesis user appear | _Pending_ | _Pending_ | _Pending_ | _Pending_ |
| A04 | Content Plan → prediction with time | one owned plan opens Predict with explicit inputs; one current immutable result is saved with model/version hashes and attached only to the same owner/brand plan | _Pending_ | _Pending_ | _Pending_ | _Pending_ |
| A05 | Prediction without time | result is saved and visibly labelled provisional | _Pending_ | _Pending_ | _Pending_ | _Pending_ |
| A06 | Input change | old result becomes stale/superseded; successor preserves history | _Pending_ | _Pending_ | _Pending_ | _Pending_ |
| A07 | Prediction failure | unavailable model/backend produces an honest error and no fabricated score | _Pending_ | _Pending_ | _Pending_ | _Pending_ |
| A08 | Snapshot, publication link, and observed outcome | brand patterns render with median/IQR/`n`; one same-brand media ID links immutably; conflicting links fail; mature verified ER renders while immature/unclassifiable outcomes remain pending/tier-unavailable | _Pending_ | _Pending_ | _Pending_ | _Pending_ |
| A09 | n8n health branch | every configured brand binding reports connected | _Pending_ | _Pending_ | _Pending_ | _Pending_ |
| A10 | n8n sync/reconcile/retrain | execution succeeds, reports each brand's `prediction_outcomes_reconciled`, and produces current evaluation-contract evidence; n8n does not create publication links | _Pending_ | _Pending_ | _Pending_ | _Pending_ |
| A11 | Restart persistence | stop/start preserves Supabase data, workflow, and encrypted credentials | _Pending_ | _Pending_ | _Pending_ | _Pending_ |
| A12 | Repository security | n8n has blocked `$env` access and receives no application token/ML URL variables | _Pending_ | _Pending_ | _Pending_ | _Pending_ |

### Failure record

If any row is `FAIL` or `BLOCKED`, record it here instead of deleting the failed
attempt. After a fix, add a new retest row and preserve the original record.

| Scenario ID | Attempt time | Failure/constraint | Root cause | Corrective action | Retest evidence | Final disposition |
| --- | --- | --- | --- | --- | --- | --- |
| _None recorded yet_ | — | — | — | — | — | — |

## Completion rule

The bachelor-thesis implementation is considered complete when:

1. the latest GitHub Actions run passes;
2. final models have `evaluation_contract = faiv-thesis-v2`;
3. `scripts/thesis_preflight.ps1` passes on the thesis machine;
4. acceptance scenarios A01–A12 are recorded;
5. final model evidence is interpreted and every model is explicitly classified
   as `validated` or `exploratory`;
6. the database, n8n volume, `.env`, and `N8N_ENCRYPTION_KEY` have a private backup;
7. `202607120003_brand_patterns_and_media_product.sql` and
   `202607120004_content_lifecycle_integration.sql` are present on the thesis
   database and the final Content Plan/publication-link scenario is recorded;
8. the thesis describes public OAuth and other enterprise-only findings as
   limitations/future work rather than implemented capabilities.
