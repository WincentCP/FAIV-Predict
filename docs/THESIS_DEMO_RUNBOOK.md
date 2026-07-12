# FAIV Predict thesis demonstration runbook

This runbook is for the bachelor-thesis prototype on the Windows thesis machine. It assumes migrations 001–004, two operator-configured brand bindings, n8n Header Auth credential, and SMTP credential have already been configured.

## Scope statement for the examiner

FAIV Predict is a Docker-based decision-support prototype that predicts Instagram content-performance tiers from verified historical post metadata. It demonstrates authenticated prediction, immutable lifecycle history, Instagram synchronization, and automated retraining. Public Instagram publishing, enterprise multi-tenancy, global high availability, and calibrated causal uplift are outside the research scope.

Instagram connection is operator-assisted: credentials and immutable account IDs
are obtained/rotated outside the product and bound to owned brands through
`IG_BRANDS_JSON`. Do not describe this as public OAuth, Meta Login, end-user
self-service onboarding, or direct publishing.

Use the precise outcome description during the demonstration: the tier represents
relative cumulative likes-and-comments engagement using a follower count captured
at first observation. It is not exact seven-day engagement, reach, sales,
virality, or a causal guarantee. The seven-day rule is a minimum maturity gate,
not a fixed-horizon metric snapshot.

## One day before the demonstration

1. Connect the laptop to power and confirm sufficient disk space.
2. Start Docker Desktop and wait until the engine is ready.
3. Pull the latest verified `main`:

   ```powershell
   cd C:\Users\User\Downloads\skripsiDraft\FaivPredict
   git pull origin main
   ```

4. Apply repository migrations in filename order before the matching services
   start. For this revision, explicitly confirm
   `202607120003_brand_patterns_and_media_product.sql` and
   `202607120004_content_lifecycle_integration.sql` succeeded in Supabase.
   Migration 003 fixes video eligibility; migration 004 adds immutable account,
   plan/publication link, and observed-outcome contracts.

5. Rebuild after the migrations, then wait for health checks:

   ```powershell
   docker compose up -d --build --wait --wait-timeout 180
   docker compose ps
   ```

6. Open `http://localhost:3000` and `http://localhost:5678`.
7. Execute both n8n branches manually. Do not re-import the workflow when the existing one already works in the persistent volume. Confirm sync reports `prediction_outcomes_reconciled` for each brand.
8. Ensure the final sync/retrain creates models using evaluation contract `faiv-thesis-v2`.
9. Export final model evidence:

   ```powershell
   docker compose exec -T ml-service python -m app.thesis_evidence --format markdown | Out-File -Encoding utf8 .\docs\FINAL_MODEL_EVIDENCE.md
   ```

10. Run the automated machine preflight:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\thesis_preflight.ps1
   ```

   The preflight must report each model complete and must not report a
   training-code fingerprint mismatch. It derives the current hash with the
   same `training_code_sha256()` function used at training time, so a model
   from before the Feed-video/Reels semantics change is not accepted.

11. Complete A01–A12 in `docs/THESIS_TEST_REPORT.md`. Record date/time, exact
    screenshot/log/query reference, and n8n execution IDs; retain unredacted
    evidence outside Git.
12. Review every exported model's `scientific_gate` and `evaluation_status`.
    Present a missing test class or zero class recall as `exploratory`, even if
    the artifact passed the separate operational promotion gate.

## Private backup

Create a local backup directory; it is gitignored:

```powershell
New-Item -ItemType Directory -Force .\backups
```

Back up the n8n volume without deleting or decrypting it:

```powershell
$N8nContainer = (docker compose ps -q n8n).Trim()
$N8nVolume = (docker inspect --format '{{range .Mounts}}{{if eq .Destination "/home/node/.n8n"}}{{.Name}}{{end}}{{end}}' $N8nContainer).Trim()
if (-not $N8nVolume) { throw "Could not resolve the n8n data volume" }
docker compose stop n8n
try {
    docker run --rm -v "${N8nVolume}:/source:ro" -v "${PWD}\backups:/backup" alpine sh -c "tar -czf /backup/n8n_data.tar.gz -C /source ."
    if ($LASTEXITCODE -ne 0) { throw "n8n backup failed" }
} finally {
    docker compose up -d --wait --wait-timeout 120 n8n
}
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5678/healthz/readiness
```

Stopping only n8n makes the SQLite archive transaction-consistent. The
frontend and ML service may remain running during this short backup.

Separately store these in an encrypted password manager or encrypted drive:

- repository-root `.env`;
- stable `N8N_ENCRYPTION_KEY`;
- Supabase database backup/export;
- `n8n_data.tar.gz`;
- final model evidence and screenshots.

Supabase database backup availability depends on the project plan. At minimum, create a logical export before the defense and verify that the file is non-empty. Supabase Storage model objects require a separate backup because a database-only export contains object metadata, not the model binaries.

Never run `docker compose down -v` during preparation or demonstration.

## Presentation sequence

### 1. Architecture and trust boundary

Show:

- browser → authenticated Next.js BFF;
- BFF → private FastAPI using internal token;
- Supabase Auth/Postgres/Storage;
- n8n → private ML endpoints using encrypted Header Auth credential.

State that the browser never receives the service key, Meta token, SMTP password, or internal API token.

### 2. Real-data readiness

Open Brands/Niches and show:

- Bison Gym and Lasence Bakeshop;
- explicit connected/disconnected state;
- real verified post counts;
- no fabricated sample data.

Select each brand on Predict and show that Brand Performance Snapshot is
brand-scoped. If the active prediction model is a niche model, point out the
separate labels: the snapshot describes only that brand's history while the
classifier uses the named cohort.

State that “connected” means the operator has configured and verified a
brand-bound Meta credential. It is not evidence of an in-product OAuth flow.

### 3. Normal prediction

1. Select a brand.
2. Review Brand Performance Snapshot before editing the draft. Show median ER,
   IQR, `n`, and evidence level for an observed format or posting-window group.
   Say “historical association,” not “the audience prefers this.”
3. Open Creative Brief/Visual Concept and state that it is optional planning
   context for Gemini, not a Random Forest feature. Show the explicitly not-
   measured audience demographics, visual/video style, content pillars,
   hooks/storytelling, and external trends.
4. Select a supported format.
5. Enter a real date, posting time, and caption.
6. Analyze.
7. Explain tier, raw class score, model scope/version, validation evidence, OOD warning, and non-causal sensitivity scenarios.
8. State that the model uses format, timing, and structural caption features; it
   does not inspect the image/video or semantically understand creative quality.

Explain the trend boundary: Graph data is synchronized and retrained weekly,
the snapshot exposes freshness and recent publishing mix, but it does not claim
a recent performance trend. Stored ER is cumulative at latest sync, so older
and newer posts cannot be compared fairly without fixed-horizon snapshots.

Do not call the raw Random Forest score a calibrated probability.

### 4. Optional posting time

Run a second draft without posting time. Show that:

- submission remains allowed;
- the result is labelled `provisional`;
- the service frequency-weights only hours actually observed in the model's
  training split (legacy artifacts visibly fall back to all 24 hours);
- setting a time later requires recalculation.

### 5. Content Plan and immutable lifecycle

1. Open Content Plan and create or select one owned entry with a supported
   brand and format.
2. Choose **Evaluate in Predict** (or **Re-evaluate in Predict**). Confirm that
   brand, caption, format, date, and optional time are transferred as explicit
   draft inputs.
3. Analyze, choose **Save to Content Plan**, then use **Open Content Plan**.
   Confirm that the plan references the saved immutable prediction rather than
   copying/overwriting the scored snapshot.
4. Change a model-used plan field and show that the old prediction becomes
   stale while its original values remain available.

Change caption, format, weekend status, or posting hour and recalculate. Show:

- original prediction remains visible;
- old evidence becomes stale/superseded;
- successor has its own model/input hashes;
- old recommendations cannot be applied as if still current.

### 6. Verified publication and observed outcome

Use a post that is safe to link during rehearsal:

1. In Published Content Analytics, select one Instagram media item verified
   under the same connected brand.
2. Explain that an exact-caption match is only an operator-assisted candidate,
   not identity. Choose **Confirm this publication**, accept the explicit
   confirmation, and show **Verified media-ID link**.
3. Show that a duplicate, cross-brand, or conflicting identity is rejected.
4. Run sync/reconciliation and show the immutable media ID, observation time,
   maturity state, and observed cumulative ER.
5. If the post is younger than seven days, show `pending maturity` rather than
   an outcome. If a consistent original-model tier rule is unavailable, show
   observed ER with `actual tier unavailable`; never calculate one manually.

Caption similarity is not acceptable linkage evidence. The plan/prediction/media
identity must be explicit and brand-consistent.

### 7. Instagram automation

Show verified Instagram insights, including correct Reels versus Feed-video
product classification, then open the latest successful n8n execution. Explain
that immutable Instagram media ID is the post identity and synchronization
never maps outcomes using caption similarity alone. n8n schedules health,
sync/reconciliation, retraining, and operator notifications; it does not select
publication links, authorize tenants, or invent actual tiers.

### 8. Academic evaluation

Open the locally exported `FINAL_MODEL_EVIDENCE.md` and present:

- sample counts and chronological split;
- majority Dummy baseline, Logistic Regression comparator, and Random Forest;
- expanding-window temporal-validation results from within the oldest 80% and
  the untouched newest-20% final result;
- confusion matrix;
- per-class support/recall, macro F1, balanced accuracy, ordinal MAE, and
  quadratic weighted kappa;
- holdout permutation importance as a complementary global diagnostic, not a
  causal explanation of one prediction;
- operational promotion versus scientific validation status;
- dataset and code fingerprints;
- limitations caused by small/brand-specific history.

Interpret evidence in this order:

1. test size and `LOW`/`AVERAGE`/`HIGH` support;
2. missing classes or zero recall;
3. comparator performance and temporal stability;
4. confusion matrix and ordinal severity of errors;
5. aggregate scores.

Do not lead with accuracy alone. If evidence is `exploratory`, say so directly
and frame the demonstrated contribution as a traceable decision-support
artifact rather than proof of generalized predictive accuracy.

## Failure demonstrations

Only perform controlled, reversible demonstrations:

- invalid caption/date/hour → typed validation message;
- no trained model for a new brand → honest unavailable state;
- unavailable or sparse Brand Performance Snapshot → honest empty/error state
  that does not block core prediction;
- unlinked, conflicting, cross-brand, or immature publication → explicit
  unlinked/error/pending state with no fabricated observed tier;
- temporarily stop only `ml-service`, refresh prediction, show service error, then restore it:

  ```powershell
  docker compose stop ml-service
  docker compose up -d --wait --wait-timeout 120 ml-service
  ```

Do not delete volumes, rotate keys, alter production RLS policies, revoke Meta tokens, or restore the database during a live defense.

## Recovery shortcuts

```powershell
docker compose up -d --wait --wait-timeout 180
docker compose ps
docker compose logs --tail=100 frontend
docker compose logs --tail=100 ml-service
docker compose logs --tail=100 n8n
```

If internet access fails, continue with locally persisted prediction history, architecture, test evidence, and the previously exported model report. Never replace unavailable live information with invented results.

If a live action fails during the defense, keep the failed state visible long
enough to explain it, record the scenario as `FAIL` or `BLOCKED`, then use the
documented recovery command. A rehearsed screenshot is supporting evidence, not
permission to describe the failed live action as successful.

## Normal shutdown

```powershell
docker compose stop
```

This preserves all named volumes and Supabase data.
