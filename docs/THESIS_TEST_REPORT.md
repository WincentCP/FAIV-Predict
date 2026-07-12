# FAIV Predict bachelor-thesis verification report

Verification date: 2026-07-12  
Scope: academic ML evidence, API behavior, secure automation template, documentation consistency, and repeatable local demonstration.

## Current verdict

The repository contains the controls and evidence-generation paths required for a bachelor-thesis prototype. Final empirical model values and the complete UI demonstration must be regenerated once after deploying this revision because those results depend on the operator's private Supabase data and authenticated local browser session.

Enterprise-scale queues, global high availability, public Instagram publishing, multi-region recovery, SSO, and formal SLA controls are explicitly outside this thesis acceptance scope.

## Automated evidence

| Gate | Command | Result on 2026-07-12 | Evidence covered |
| --- | --- | --- | --- |
| ML/API suite | `python -m pytest -q` in `ml-service` | PASS — 48 tests | Authentication, validation, honest unavailable states, optional time, API successor request contract, maturity/provenance, sync identity, feature parity, three-class and promotion gates, bounded rejection diagnostics, evaluation artifact and effective-model-scoped safe exporter. Real Supabase trigger/RLS behavior remains in A03/A06. |
| Repository contract | `python scripts/verify_thesis_readiness.py` | PASS | Secure n8n template, blocked `$env`, documentation alignment and required thesis artifacts |
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
- macro and weighted precision, recall, and F1;
- per-class precision, recall, F1, and support;
- fixed `LOW`, `AVERAGE`, `HIGH` confusion matrix;
- train/test class distributions;
- exact model parameters and random seed;
- collision-resistant model version and dependency/runtime evidence;
- baseline-relative promotion decision (rejected candidates do not replace the active model);
- empirical posting-hour support for provisional predictions;
- verified-post count and data time window;
- seven-day minimum post-age gate and cumulative-observation policy;
- SHA-256 of the exact identity/label/feature dataset manifest;
- SHA-256 of the training and preprocessing source;
- versioned `faiv-thesis-v1` evaluation contract.

Raw captions, connection strings, Instagram tokens, and service secrets are excluded from evaluation evidence.

After rebuilding and running the final retraining, export the actual private-data results for the thesis appendix:

```powershell
docker compose exec -T ml-service python -m app.thesis_evidence --format markdown | Out-File -Encoding utf8 .\docs\FINAL_MODEL_EVIDENCE.md
```

`FINAL_MODEL_EVIDENCE.md` may be retained locally if brand/model details should not be published. Review it before committing.

## Operator evidence already established

The operator reported and showed the following on the thesis machine before this revision:

- Supabase migrations applied and Advisor findings addressed;
- frontend, ML service, and n8n containers running with healthy status;
- Instagram bindings resolving to Bison Gym and Lasence Bakeshop;
- n8n sync/retrain workflow completing successfully;
- n8n credentials surviving container recreation;
- `N8N_BLOCK_ENV_ACCESS_IN_NODE=true` deployment with workflow secrets moved to encrypted Credentials.

These observations prove the current persistent installation works. The runbook requires one post-revision rehearsal to prove that the repository, rebuilt image, new evaluation contract, and existing private integrations work together.

## Final acceptance scenarios

Record PASS/FAIL and a screenshot or execution ID for each scenario during the final rehearsal.

| ID | Scenario | Expected result | Status |
| --- | --- | --- | --- |
| A01 | Start Docker stack | frontend, ml-service, and n8n become healthy | Post-revision rehearsal required |
| A02 | Login | valid thesis user reaches Dashboard; invalid credentials fail safely | Post-revision rehearsal required |
| A03 | Brand ownership | only Bison Gym and Lasence Bakeshop records owned by the user appear | Post-revision rehearsal required |
| A04 | Prediction with time | one current immutable result is saved with model/version hashes | Post-revision rehearsal required |
| A05 | Prediction without time | result is saved and visibly labelled provisional | Post-revision rehearsal required |
| A06 | Input change | old result becomes stale/superseded; successor preserves history | Post-revision rehearsal required |
| A07 | Prediction failure | unavailable model/backend produces an honest error and no fabricated score | Covered automatically; optional UI screenshot |
| A08 | Instagram insights | verified media IDs and stored engagement evidence render | Post-revision rehearsal required |
| A09 | n8n health branch | both configured brands report connected | Previously passed; repeat after rebuild |
| A10 | n8n sync/retrain | execution succeeds and creates `faiv-thesis-v1` model evidence | Post-revision rehearsal required |
| A11 | Restart persistence | stop/start preserves Supabase data, workflow, and credentials | Previously passed; repeat after rebuild |
| A12 | Repository security | n8n process has no application token/ML URL environment access | Covered by static and runtime preflight |

## Completion rule

The bachelor-thesis implementation is considered complete when:

1. the latest GitHub Actions run passes;
2. final models have `evaluation_contract = faiv-thesis-v1`;
3. `scripts/thesis_preflight.ps1` passes on the thesis machine;
4. acceptance scenarios A01–A12 are recorded;
5. the database, n8n volume, `.env`, and `N8N_ENCRYPTION_KEY` have a private backup;
6. the thesis describes enterprise-only findings as limitations/future work rather than implemented capabilities.
