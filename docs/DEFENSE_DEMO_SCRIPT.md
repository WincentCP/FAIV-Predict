# FAIV Predict defense demo script

Status: script ready; final runtime checks, screenshots, and rehearsal records are pending the thesis machine and valid credentials.

## Required artifacts before presenting

Keep these in a local, access-controlled defense folder, not in Git:

```text
00-final-commit.txt
01-compose-status.txt
02-instagram-health-redacted.json
03-sync-summary-redacted.json
04-model-evidence.md
05-model-evidence.json
06-data-volume-and-scope.md
07-cumulative-er-sensitivity.md
08-thesis-preflight.txt
screenshots/
```

Every artifact must show a date/model version/hash where applicable and contain no tokens, cookies, database URLs, email addresses, raw captions, or participant data.

## Day-before commands

Run on the configured Windows thesis machine after rebuilding the final code:

```powershell
docker compose up -d --build
docker compose ps
powershell -ExecutionPolicy Bypass -File .\scripts\thesis_preflight.ps1

New-Item -ItemType Directory -Force .\evidence | Out-Null
docker compose exec -T ml-service python -m app.thesis_evidence --format markdown |
  Out-File -Encoding utf8 .\evidence\FINAL_MODEL_EVIDENCE.md
docker compose exec -T ml-service python -m app.thesis_evidence --format json |
  Out-File -Encoding utf8 .\evidence\FINAL_MODEL_EVIDENCE.json
docker compose exec -T ml-service python -m app.data_volume_report --format markdown |
  Out-File -Encoding utf8 .\evidence\DATA_VOLUME_AND_SCOPE.md
```

Run `app.cumulative_er_sensitivity` once for each served account/niche scope, passing both hashes from final model evidence. A hash mismatch is a stop condition, not a warning to bypass.

## Screenshot fallback set

Capture the same sanitized test case used in the live rehearsal:

| File | Screen/evidence |
| --- | --- |
| `01-architecture.png` | Architecture and trust-boundary slide. |
| `02-brands-health.png` | Bound brands and green connection state; no identifiers/tokens. |
| `03-model-health.png` | Balanced accuracy, macro-F1, QWK, raw accuracy, status, version, and served scope. |
| `04-compose.png` | Completed Creative Brief before prediction. |
| `05-result-summary.png` | Tier, one-line reason, and top alternatives. |
| `06-result-evidence.png` | Expanded model/evidence details and uncalibrated-score wording. |
| `07-trend-insights.png` | Dated user notes/internal mix momentum with advisory disclaimer. |
| `08-calendar-link.png` | Prediction linked to Content Plan. |
| `09-history.png` | Immutable lifecycle record and realized outcome/unavailable state. |
| `10-instagram-insights.png` | Live or stored verified history with provenance. |
| `11-evidence-table.png` | Final hash-bound model appendix. |
| `12-preflight.png` | All final preflight checks passed. |

Do not capture a screen until it displays real final data. A screenshot is fallback evidence, not a substitute for T1.1.

## Ten-minute primary presentation

### 0:00-1:00 - Scope and architecture

Say:

> FAIV Predict is an authenticated Instagram content decision-support prototype. It estimates a relative tier from ten observable metadata and caption-structure features. It does not publish content, inspect media, promise engagement, or expose service credentials to the browser.

Show the one-page architecture story and identify browser, BFF, private FastAPI, Supabase, Meta, model Storage, optional Gemini, and n8n.

### 1:00-2:00 - Real-data readiness

Open Brands/Model Health. Show the configured brand, connection state, eligible-post count, actual serving scope, model version, and scientific status. Lead with balanced accuracy, macro-F1, and QWK; show raw accuracy last.

Say the exact frozen sample sizes and scope from `DATA_VOLUME_AND_SCOPE.md`. If a model is exploratory, call it exploratory.

### 2:00-4:30 - Prediction

1. Select the rehearsed brand.
2. Fill the structured brief, supported format, caption, date, and time.
3. Submit once; do not double-click or improvise inputs.
4. Show tier, one-line reason, and top three model-supported alternatives.
5. Expand evidence details; point to scope, version, OOD state, and uncalibrated score wording.

Say:

> These alternatives are sensitivity checks with the same model, not causal uplift promises.

### 4:30-5:30 - Trends and creative guidance

Show up to three dated, sourced trend notes and one or two internal format-mix momentum statements.

Say:

> User notes are unverified advisory context. Internal momentum prefers publication-mix shares. Cumulative ER medians across recent and prior windows are age-confounded and cannot be called a performance trend. None of these fields changes the Random Forest tier.

If Gemini is unavailable, show the honest unavailable state and continue; this must not block ML inference.

### 5:30-7:00 - Lifecycle and verification

Link the prediction to Content Plan, then open History. Show predicted tier, immutable version/model context, and realized tier only if a mature verified outcome exists. Explain match/one-off/miss as a tier-distance description under the original thresholds, not a statement that the model understood audience causality.

### 7:00-8:30 - Model evidence

Open the compact appendix. Quote dataset window, train/holdout sizes, thresholds, balanced accuracy, macro-F1, QWK, confusion matrix, both gates, and top permutation evidence. Show the dataset and training-code hashes.

Say:

> The operational gate decides availability; the scientific gate decides claim strength.

### 8:30-9:30 - Strongest limitation

Show the cumulative-ER sensitivity report: post-age correlation, age strata, and metric changes after excluding the oldest 20%. State the result exactly as generated.

Say:

> The analysis quantifies sensitivity but does not remove the limitation. Equal-age, fixed-horizon snapshots are required in future work.

### 9:30-10:00 - Contribution and boundary

Conclude with the reproducible evidence chain and one user-study finding only if real sessions were completed. Name deliberately excluded enterprise features without apologizing for them.

## Stored-data fallback

If network/Meta access fails:

1. Do not refresh repeatedly or expose provider errors.
2. State that the live dependency is unavailable and switch to stored verified history.
3. Continue through saved prediction History, Model Health, final evidence exports, sensitivity report, and sanitized screenshots.
4. Show the last successful health/sync artifact and its timestamp.
5. Never replace missing live data with fabricated examples.

If the application itself fails, use the screenshot sequence and final evidence files. Do not change environment variables, migrations, volumes, tokens, or production data during the defense.

## Stop conditions

Do not present a live empirical claim when any of these is true:

- a model's recorded training-code hash differs from the final source;
- the sync result is `partial`;
- a configured brand has no served model and the demo narrative assumes one;
- evidence, data-volume, and sensitivity artifacts cite different versions/hashes;
- credentials or personal data are visible;
- the preflight has a failed check; or
- a user-study number cannot be traced to real participant records.

Use the fallback deck and state the limitation honestly.

## Rehearsal log

Complete two rehearsals after final token validation.

| Rehearsal | Date/time | Commit | Duration | Primary/fallback | Preflight pass? | Issues | Fix verified? |
| --- | --- | --- | ---: | --- | --- | --- | --- |
| 1 | **Pending** | **Pending** | **Pending** | **Pending** | **Pending** | **Pending** | **Pending** |
| 2 | **Pending** | **Pending** | **Pending** | **Pending** | **Pending** | **Pending** | **Pending** | **Pending** |

T6.4 is not complete until both rows contain real dated rehearsal evidence and the screenshot set is verified offline.
