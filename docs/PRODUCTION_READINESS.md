# Enterprise Production Review

Review date: 2026-07-12  
Scope: FAIV Predict source code, database schema, ML pipeline, Next.js BFF, n8n workflow, and product UX.

## Executive verdict

FAIV Predict performs real Random Forest inference and fails closed when no certified model exists. It is not a fabricated demo. It is also not ready to be sold as an enterprise-grade prediction platform yet.

## Bachelor-thesis release boundary

Enterprise readiness is a future-work review, not the acceptance contract for the bachelor-thesis prototype. The thesis release requires real-data provenance, leakage-resistant chronological evaluation, a transparent baseline, per-class/confusion-matrix evidence, reproducible dataset/code fingerprints, secure local integration, automated tests, and one recorded end-to-end demonstration. Those gates are maintained separately in `THESIS_TEST_REPORT.md` and `THESIS_DEMO_RUNBOOK.md`.

The thesis does not claim public Instagram publishing, calibrated causal uplift, enterprise multi-user governance, globally distributed scaling, managed disaster recovery, or contractual SLA compliance.

The Predict workflow is the strongest part of the product, but its current scores are uncalibrated, duplicate POST requests are not idempotent, and deployment has thesis-level operational/scientific gates rather than full enterprise champion/candidate control. The product also has no durable publication-job architecture. Calendar is a planning workspace, not an Instagram publishing engine.

This release adds a safety foundation:

- Posting time is optional.
- A prediction without time frequency-weights the model artifact's empirically observed training hours and is labeled provisional. Legacy artifacts without support metadata fall back to all 24 hours and disclose that limitation.
- Scheduled date is required because the model derives a weekend feature from it.
- Prediction snapshots are immutable.
- Recalculation creates a successor rather than rewriting prior evidence.
- Cross-brand predictions start a new lineage.
- Current, provisional, stale, and superseded states are persisted.
- Exact model ID, model version, feature-schema hash, and raw-input hash are stored.
- User deletion is a reversible soft archive.
- Lifecycle changes are written to an audit event table.
- Invalid JSON types for posting hour are rejected.
- Stale Insights render the original scored snapshot and cannot apply old recommendations.
- The UI now calls Random Forest output a raw class score, not a calibrated probability.
- Counterfactuals are described as non-causal model sensitivity scenarios.
- Compose now includes a brand-scoped Brand Performance Snapshot before the
  Creative Brief and scored inputs. It reports medians, IQR boundaries, sample
  counts, evidence levels, and freshness from mature verified history without
  claiming causal audience preference.
- Audience demographics, content pillars, visual/video style,
  hooks/storytelling, seasonality, and external trends are explicitly shown as
  not measured rather than being invented by an LLM.
- Meta product classification is retained so Feed video is not silently mapped
  to Reels.

These changes are an important safety slice. They do not replace the remaining production architecture described below.

## How to read the scenario tables

Every row covers the requested review dimensions:

- Trigger and risk
- Frontend behavior and user notification
- Backend processing
- Database consistency
- n8n or worker responsibility
- Prediction validity
- Audit history
- Training and accuracy impact
- Recommended production rule

## Priority 1: Predict workflow

### Recommended end-to-end flow

1. A user edits a versioned content revision.
2. The frontend validates required fields locally but treats backend extraction as authoritative.
3. The client creates one idempotency key and retains it across retries.
4. The BFF authenticates the session, authorizes brand access, applies quota limits, and records a prediction request.
5. The prediction service snapshots the active model deployment once.
6. A versioned feature service normalizes text and produces the exact feature manifest.
7. Eligibility, training-support, and out-of-distribution checks run.
8. A calibrated model either returns a tier or abstains.
9. The immutable result is committed with model, feature, input, and deployment lineage.
10. Explanation and recommendation work runs under a separate time budget.
11. The UI retrieves the result by request ID, even if the original response was lost.
12. Later edits create a new revision and mark the prior result stale only when a model-used feature changes.

Recommended request states:

- accepted
- running
- succeeded
- failed
- timed_out
- cancelled_by_client

Recommended result states:

- current
- provisional
- stale
- superseded
- linked_to_publication

### Input, request, and inference scenarios

| Scenario | Trigger and risk | Frontend and notification | Backend, database, and automation | Prediction, audit, and training rule |
| --- | --- | --- | --- | --- |
| Missing caption | Empty or whitespace caption; model receives meaningless structure | Block Analyze, focus the field, show exact requirement | BFF and ML both reject; write security telemetry but no prediction row | No prediction; do not train; audit repeated abuse only |
| Very short caption | One or two characters can be valid but outside useful history | Allow with a low-information warning | Extract normally; run support checks | Return only if in support; otherwise abstain or label low evidence; retain length in manifest |
| Very long caption | Over Instagram or model limits; latency and cost rise | Show live count and hard limit | Reject above 2,200 characters before ML or LLM calls | No prediction; never truncate silently because the scored text would differ |
| Invalid Unicode | Broken surrogate, combining marks, zero-width characters | Preserve user text and explain invalid encoding if necessary | Normalize to NFC in one authoritative service; store raw and normalized values | Use versioned normalization; include multilingual golden tests |
| Unsupported format | Story, Live, or unknown type | Disable unsupported choices; explain supported formats | Reject with typed 400 error | No fallback mapping; do not train unknown formats as Single Image |
| Missing date | Weekend feature would otherwise use an invented server date | Require a real posting date | Reject before model loading | No prediction; never default to server today |
| Missing posting time | User has not committed a time | Allow; show Provisional before submission and in result | Preserve null; evaluate train-supported hour scenarios; disclose legacy all-hour fallback; store scenario weights | Provisional; recalculate when time is committed; exclude provisional rows from outcome-quality evaluation until finalized |
| Invalid posting time type | JSON true, false, array, string, or out-of-range number | Show integer 0 to 23 requirement | Require a real JSON integer; never coerce | No prediction; audit malformed API abuse by request ID |
| Unknown timezone | Browser hour may not equal brand publishing timezone | Require brand timezone before enterprise use | Store IANA timezone, local scheduled time, and UTC instant | Provisional or blocked until timezone is known; use the same conversion in training |
| Duplicate click | Double event before React updates | Disable action immediately and show one request | Idempotency key plus unique tenant/key record | Return the same result; never create duplicate rows or training examples |
| Retry after lost response | Server saved result but browser timed out | Show “Check existing request” before Retry | Retrieve by request ID and original idempotency key | Same immutable result; log response loss separately |
| Multiple tabs or devices | Same user predicts the same revision concurrently | Show active request and latest completed result | Lock revision or allow one active request per revision/model deployment | One canonical result per request; intentional reruns are successor versions |
| User cancels | User leaves or clicks Cancel during loading | Stop waiting immediately; retain request ID | Abort downstream work when safe; if commit already occurred, finish and expose retrievable state | Cancellation does not delete a completed result; audit client cancellation |
| Slow ML response | Cold model, storage delay, DB pressure | Show staged progress, deadline, Cancel, and no fake percentage | Client 12s, BFF 10s, ML 8s; typed timeout | Do not retry POST without idempotency; record component latency |
| Feature extraction fails | Parser bug or unsupported content | Show “Could not analyze this text” with retry | Fail before inference; capture extractor version and safe error code | No result and no training row; quarantine input for QA with privacy controls |
| Model not trained | Cold-start brand and no eligible cohort model | Explain data requirement and offer sync status | Return MODEL_NOT_TRAINED, not a generic 503 | No fabricated score; never substitute a random or stale artifact |
| Model registry outage | Database cannot resolve active deployment | Show temporary service problem | Return MODEL_REGISTRY_UNAVAILABLE | Do not claim model absent; alert on-call |
| Artifact unavailable or corrupt | Storage timeout, checksum mismatch, unsafe artifact | Show temporary unavailability | Verify signed checksum before deserialization; keep champion serving | Reject candidate; never load untrusted joblib; security alert and audit |
| Core prediction succeeds, explanation fails | Optional explanation exceeds its budget | Show tier with “Explanation unavailable” | Persist core result first; explanation worker has separate state | Prediction remains valid; missing explanation never becomes fabricated text |
| Low model certainty | Calibrated confidence is below threshold | Show “No reliable tier” instead of strong color verdict | Apply abstention policy by deployment | Do not force High, Average, or Low; store abstention and use it in evaluation |
| Out-of-distribution input | Numeric or joint feature combination is unsupported | Show exact unsupported fields and cautious action | Run univariate and joint support checks | Abstain or mark low-support; suppress unsupported recommendations |
| Batch predictions | User imports many revisions | Show queue, row states, cancel pending, downloadable failures | Async batch API, per-tenant quotas, chunking, durable queue | Each row has its own request/model/input lineage; no all-or-nothing batch |
| Cached result reuse | Exact same revision and active model already scored | Label reused result and its timestamp | Tenant-scoped cache key includes input, model, extractor, calibration, and timezone | Valid only for exact key; model promotion or feature change misses cache |
| Model promotion during inference | Champion changes while a request runs | No visible inconsistency | Snapshot deployment once at acceptance | In-flight request stays on one deployment; audit deployment ID |
| Database commit fails | Inference completed but evidence cannot be stored | Show no final result and safe retry | Roll back and return typed persistence failure | Never display an untracked enterprise prediction |
| Service overload | Burst exceeds capacity | Show queued state or 429 with retry-after | Admission control, priority queue, tenant quotas, autoscaling | No silent drops; measure queue age and rejection rate |

### Prediction changes and validity rules

The production rule should compare a versioned model-input hash, not simply every visible field. Every content and schedule change is audited, but only a change to a feature consumed by the active model invalidates the ML result.

| Change | Recommended validity rule | User experience | Persistence and automation |
| --- | --- | --- | --- |
| Caption edited | Stale because several text features may change | Keep old result visible as snapshot; disable old actions; primary Recalculate button | Create content revision; never mutate prediction row; audit changed-field mask and hashes |
| Date moves weekday to weekend or reverse | Stale because is_weekend changes | Warn and recommend recalculation | Reschedule publish job, append schedule event, create successor after recalculation |
| Date moves Monday to Tuesday | Numerically valid for the current model, but schedule changed | Keep result with “Schedule changed, score inputs unchanged” | Audit reschedule; do not waste inference unless future model uses date features |
| Time changes to a different hour | Stale because post_hour changes | Mark stale immediately after saved change | Cancel old publish job idempotently; enqueue one replacement; recalculate after stable save |
| Time changes within the same hour | Valid for the current model | Update schedule without claiming score changed | Audit exact time; feature hash remains equal |
| Time added to provisional result | Stale until recalculated, then successor becomes current | Prompt “Finalize prediction with this time” | Store reason time_finalized and preserve provisional parent |
| Time removed | Current result becomes stale; new result is provisional | Confirm because approval certainty decreases | New successor with null time and scenario distribution |
| Multiple reschedules | Apply the same feature-hash rule to each committed revision | Collapse noisy warnings but show full timeline | One active publish job; all schedule revisions retained |
| Format changes | Stale | Warn that model input changed | New revision and successor prediction |
| Brand changes | Old lineage stays with old brand; new brand starts a new lineage | Clear brand-specific trust context and ask for a new prediction | Never supersede across tenants or brands; authorize both operation and data |
| Media replaced, same format | Current model score remains numerically valid because media is not inspected; creative approval becomes stale | Explicitly disclose that visuals are not scored | Audit asset revision; future vision-enabled model would invalidate |
| Visual Concept changes | ML result remains valid because concept is not a feature; AI analysis becomes stale | Mark old Gemini analysis stale, not the Random Forest result | Persist concept revision and AI input hash separately |
| Model version changes | Existing historical result remains valid as evidence from its original model | Offer optional Re-evaluate with current model | New result is a manual/model refresh successor; never rewrite old model lineage |
| Brand timezone changes | Stale if derived local hour or weekend changes | Explain converted old and new schedule | Recompute canonical UTC and feature hash; reschedule jobs |
| Prediction recommendation applied | Old result becomes stale because actual edited caption can change several features | “Apply to Draft,” then explicit or safe automatic Analyze | Save new content revision and score the actual final payload |

Do not automatically run paid inference on every keystroke. Mark the displayed result stale immediately. Recalculate on an explicit user action, on a committed revision after a short debounce, or as part of approval only when idempotency and quotas are in place.

### Confidence and explainability

Current Random Forest vote proportions are raw class scores, not calibrated probabilities. Enterprise release requires:

- Out-of-fold isotonic or Platt calibration on temporal validation data.
- Expected Calibration Error, Brier score, log loss, and reliability bins.
- A deployment-specific abstention threshold.
- Copy that distinguishes raw model score, calibrated confidence, and held-out accuracy.
- Cohort copy that says cohort history, not the brand’s own history.
- A minimum evidence policy for low-sample and out-of-distribution cases.

Global MDI importance does not explain one exact prediction and is biased toward features with more split opportunities. Production explainability should use:

- Held-out permutation importance for global model behavior.
- TreeSHAP or equivalent signed local attribution for one result.
- Baseline, signed contributions, explanation version, model ID, and input hash.
- Reconstruction tests proving local contributions match the model output.
- A clear statement that explanations describe model behavior, not causality.

Counterfactual recommendations must be called model sensitivity scenarios. They should include support status and must never promise real uplift. Adding a CTA or hashtags changes caption length too, so the final rewritten draft must always be scored again.

### AI recommendation scenarios

| Scenario | Risk | Production behavior |
| --- | --- | --- |
| LLM unavailable | Core product appears broken even though ML works | Keep Predict available; show AI Assistant unavailable with retry; no placeholder advice |
| Hallucinated recommendation | Unsafe, off-brand, or unsupported claim | Treat as advisory; validate schema and safety policy; require user acceptance |
| Partial JSON | UI crashes or silently omits fields | Strict response schema; one repair attempt; otherwise explicit unavailable state |
| High latency | User waits for an optional feature | Separate 5 to 8 second budget, cancellation, async retrieval, and cached exact input hash |
| Stale AI output | Old suggestion overwrites a newer caption or concept | Store input hash; label stale; disable Replace unless regenerated or explicitly confirmed |
| Prompt injection in concept | User content overrides system rules | Structured prompts, clear data boundaries, output validation, content filtering |
| Excessive cost | Automated or abusive repeated calls | Tenant quota, token budget, input-hash cache, usage ledger, admin controls |
| Sensitive creative brief | Unpublished campaign leaks to provider | Explicit disclosure, tenant AI-disable switch, retention policy, provider DPA, redaction |
| Missing recommendation | Product fabricates generic advice | Show none; core prediction remains usable |
| Low-quality advice | Users trust fluent but irrelevant output | Feedback controls, acceptance tracking, offline evaluation, prompt/model versioning |

AI outputs should store provider, exact model, prompt version, content revision, input hash, response, timestamp, and acceptance state. LLM advice must never be mixed with model evidence.

### Brand Performance Snapshot and trend policy

The thesis-scope system now provides useful pre-prediction context without
claiming capabilities absent from its data. For each selected brand it
summarizes observed format, WIB daypart, weekday/weekend, CTA, question, emoji,
caption-length, and hashtag groups using median cumulative ER, first/third
quartiles, sample size, and median difference from the overall brand in
percentage points. Robust summaries reduce the effect of viral outliers, but do
not remove confounding.

Evidence-level rules are deliberately conservative UI guards:

- fewer than 5 posts: `limited` and never highlighted;
- 5–14 posts: `exploratory`;
- 15 or more posts: `directional`;
- at least 20 total eligible posts and two eligible groups before naming a
  highest-observed group.

These cutoffs are not p-values, confidence intervals, minimum causal sample
sizes, or proof of audience preference. Product copy must say “highest observed
median ER,” include `n` and IQR, and keep the data scope visible. When a brand
uses a niche fallback model, the UI distinguishes brand-only descriptive
patterns from cohort-based prediction.

Current trend adaptation is limited to fresh Graph synchronization, weekly
retraining, a freshness indicator, and recent 90-day **publishing mix**. Recent
and prior performance are not compared because cumulative ER measured at the
latest sync gives older posts more opportunity to accumulate engagement. No
demographic, visual/multimodal, reviewed content-pillar, seasonal-event, or
external trend source exists today. A defensible future trend layer requires
append-only fixed-horizon metric snapshots, time-aware drift evaluation, and
sourced/versioned trend signals with region, niche, retrieval time, expiry, and
prediction-time availability. The history/trend weight must be selected by
temporal validation, not an arbitrary product percentage.

## Visual Concept and Content Details

### Codebase verdict

Visual Concept was intentionally excluded from ML, not accidentally removed.

The current model trains on Graph-derived historical data. That history contains format, caption structure, posting time, and engagement. It does not contain the unpublished creative brief that existed before each historical post. Feeding Visual Concept only at prediction time would create training-serving skew.

Current behavior:

- Predict page shows the optional Creative Brief/Visual Concept as a visible
  planning section after the Brand Performance Snapshot and keeps it in React
  memory.
- AI Assistant sends it to authenticated, brand-authorized Gemini concept
  analysis and caption refinement routes. Only aggregate safe brand-pattern
  context is added; raw historical captions and media IDs are not sent.
- Predict BFF, FastAPI, preprocessing, training, model bundle, sync, n8n, and prediction history do not use it.
- Calendar content_details and visual_reference are separate planning fields.
- Calendar does not load Visual Concept into Predict.
- A concept-only change does not change the Random Forest result.
- Applying a concept-conditioned caption rewrite can indirectly change prediction features.
- Client request snapshots, cancellation, and stale-output guards prevent an
  older concept/caption response from silently replacing newer draft work.

Recommended user copy:

> Visual Concept is not scored directly. If you apply an AI-rewritten caption, run the prediction again because the new caption may change the result.

### With versus without Visual Concept

| Dimension | Without concept in ML | Concept directly in ML now | Recommended architecture |
| --- | --- | --- | --- |
| Accuracy | Honest baseline using reproducible Graph features | Likely training-serving skew and unstable semantics | Keep it excluded until pre-publication briefs are historically linked to outcomes |
| Recommendation quality | Caption advice has less creative context | Better LLM context, but not necessarily better predictive evidence | Use persisted concept for LLM planning only |
| UX | Faster and simpler, but product scope can be misunderstood | More input effort and false expectation that visuals are scored | Optional versioned brief with explicit inclusion/exclusion manifest |
| Feature engineering | Stable deterministic features | Requires semantic extractor, versioning, drift tests | Build an offline candidate after sufficient labeled brief history |
| Backend and DB | Simple but ephemeral creative work | More services and lineage | content_item, content_revision, creative_analysis, and asset references |
| Inference speed | Fast | Slower and provider-dependent | Keep core model independent; semantic features only in a certified future deployment |
| Maintainability | Low complexity | High prompt and embedding drift | Feature registry and fallback model without semantic features |
| Scalability | Straightforward | LLM cost and rate limits | Async cached concept analysis, not synchronous core inference |

### Remaining Visual Concept limitations

Critical or high:

- Concept, analysis, prompt version, and accepted AI outputs are not persisted.
- Calendar Content Details, Visual Reference, and Predict Visual Concept are disconnected.
- Gemini receives unpublished briefs without a tenant-level disable policy or explicit enterprise disclosure.
- No direct tests verify that concept never enters the prediction payload.

Medium or low:

- Gemini content_type means creative archetype, while Calendar content_type means media format.
- Calendar content_details behaves like a title or summary and should be renamed.
- Analyze Concept output is not reused by Caption Refine, duplicating cost and interpretation.
- Calendar export and desktop rendering treat visual fields inconsistently.

Recommended data model:

- content_items
- content_revisions
- creative_analyses
- asset_references
- prediction_requests
- prediction_results
- prediction_explanations
- prediction_recommendations
- recommendation_actions

Only add concept-derived ML features after briefs are saved before publication, linked to immutable Instagram media IDs, extracted with one versioned semantic model, and proven to improve out-of-time validation.

## Content planning scenarios

| Scenario | Frontend and notification | Backend, DB, automation, ML, and audit |
| --- | --- | --- |
| Draft deleted | Confirm if scheduled, approved, or linked to a job | Soft delete content item; cancel pending jobs through outbox; prediction evidence remains; exclude deleted unposted drafts from training |
| Draft restored | Show current schedule and whether slot is still available | Restore as a new revision; do not revive canceled job automatically; audit restorer |
| Two drafts share schedule | Warn but allow authorized override | Unique policy only if business requires it; otherwise conflict event and team notification |
| Media upload fails | Keep text draft and resumable upload state | Multipart/resumable upload, checksum, malware scan, orphan cleanup |
| Approval after later edit | Approval no longer applies | Approval references exact revision hash; edit invalidates approval |
| Past date selected | Explain whether planning history or future schedule is intended | Reject scheduling in past; allow historical import through separate route |
| Midnight or DST boundary | Show timezone and UTC equivalent | Store IANA zone plus UTC; never use a fixed UTC+7 conversion globally |
| Brand transfer | Warn about ownership and historical access | Transactional tenant transfer or immutable export; never relabel old data silently |

Recommended independent state machines:

- Content: draft, in_review, approved, archived, deleted
- Publication: unscheduled, scheduled, publishing, published_unverified, published_verified, failed, missed, canceled
- Prediction: none, running, current, provisional, stale, superseded, failed

One overloaded status column cannot safely represent all three.

## Publishing scenarios

The current repository does not implement a production Meta publishing engine. Calendar records plans; n8n currently synchronizes and retrains. Do not show “scheduled publishing” as complete until these rules exist.

| Scenario | Frontend and notification | Backend, DB, automation, prediction, and training |
| --- | --- | --- |
| Manual publish | Ask user to link or verify the media | Reconcile by immutable media ID; prediction stays valid, publication timing deviation is stored |
| Early or late publish | Show planned versus actual time | Actual media timestamp is authoritative; prediction becomes observed, not rewritten; train on actual time |
| Post never published | Mark missed after grace window | Durable watchdog; cancel future retries; exclude from outcome training |
| Duplicate publish | Warn and provide both media links | Idempotency key and unique publication attempt; never delete one silently |
| Ambiguous timeout | Do not offer immediate blind retry | Reconcile Meta container/media status before retry |
| Instagram rejects media | Show provider reason and remediation | Typed failure, no endless retry for permanent errors; retain request/response IDs |
| Token expired | Show reconnect action | Pause jobs; refresh or reauthorize; notify owner and operator |
| Permission scope removed | Explain exact missing permission | Health check scope set; block publishing until restored |
| Webhook missing | Show verification pending | Poll reconciliation worker; webhook is an accelerator, not the only source |
| User deletes published post | Mark deleted remotely | Keep historical observation with tombstone; follow retention policy |

## Synchronization and analytics

| Scenario | Production behavior |
| --- | --- |
| Duplicate webhook | Verify signature; deduplicate by provider event or media/version key; return 2xx for replay |
| Webhook arrives before publish response | Upsert publication/media link transactionally; later response attaches to the same record |
| Delayed Meta metrics | Store observation timestamp and maturity horizon; show “data still maturing” |
| Missing metrics | Keep null distinct from zero; record unsupported, permission-denied, and not-yet-ready reasons |
| Partial brand sync | Per-brand and per-media checkpoints; successful rows commit independently; failed items retry |
| Incorrect mapping | Never use caption as identity; quarantine ambiguous matches for review |
| Reused caption | Immutable media ID prevents false linkage |
| Engagement increases later | Append metric snapshots instead of overwriting; train only on a defined maturity horizon |
| Historical metric correction | New observation version; preserve prior value and source timestamp |
| Edited published caption | Store caption snapshot history; train with the version and timing policy defined by feature contract |
| Viral outlier | Keep for analytics; robust winsorization or sample weighting for training; flag influence |
| Purchased or bot engagement | Fraud/anomaly features and exclusion policy; never silently contaminate labels |
| Seasonal trend | Time-aware validation, rolling windows, campaign/holiday features only when available at prediction time |
| Follower count changes | Use follower count captured at post/observation horizon, not today’s audience |
| Deleted Instagram post | Tombstone, do not hard delete observations; exclude according to documented policy |
| Meta API version change | Contract tests, version pinning, deprecation alerts, staged rollout |

Required analytics model:

- publication
- external_media
- engagement_observation
- observation_metric
- synchronization_run
- synchronization_item

A single mutable post row cannot preserve metric maturity or correction history.

## Machine learning and MLOps

| Scenario | Production solution |
| --- | --- |
| Retraining while predicting | Champion deployment snapshot per request; candidate trains separately; atomic promotion |
| Dataset drift | Monitor feature distributions, support coverage, missingness, and brand mix |
| Concept drift | Monitor temporal accuracy, calibration, abstention, and tier confusion after labels mature |
| Cold-start brand | Eligible cohort model with explicit disclosure; otherwise abstain |
| Insufficient history | Do not lower thresholds silently; show exact data requirement |
| One-class or two-class data | Reject candidate promotion unless product contract explicitly supports reduced classes |
| Viral outliers | Robust evaluation and influence reports; never remove solely because performance is high |
| Model rollback | Immutable deployment registry and one-click champion rollback; invalidate deployment cache |
| Feature update | New feature schema and extractor version; shadow evaluation; never reinterpret old vectors |
| Experiment tracking | Dataset snapshot, code SHA, parameters, metrics, artifact hash, and approver |
| Calibration drift | Reliability monitoring and scheduled recalibration |
| Continuous evaluation | Join predictions to mature verified outcomes by immutable publication ID |
| Training job crash | Durable queue heartbeat, lease, retry, and DLQ; FastAPI BackgroundTasks is insufficient |
| Version collision | Database-generated deployment identity; version string is display metadata only |
| Unsafe artifact | Signed checksum, restricted bucket, safe format where possible; never deserialize arbitrary joblib |
| Cohort domination | Report contributing brand count and concentration; cap or weight dominant brands |
| Label leakage | Training cutoffs and maturity windows; no future metrics or current followers in historical rows |

Promotion gate should include temporal validation, class coverage, calibration, OOD coverage, fairness across brands, latency, artifact verification, and regression against the active champion. A new model must never become active merely because training finished.

## Multi-user collaboration

| Scenario | Production solution |
| --- | --- |
| Two users edit one draft | Optimistic concurrency with revision number or ETag; show field-level conflict |
| Simultaneous schedule changes | Compare-and-swap current revision; one winner, one conflict resolution view |
| Permission changes while job queued | Reauthorize at execution time, not only enqueue time |
| User removed during edit | Preserve local unsaved text, block commit, explain access change |
| Approval conflict | Approval binds to exact revision and is invalidated by edits |
| Activity timeline | Append actor, source, action, object, before/after hashes, timestamp, correlation ID |
| Version history | Immutable revision chain with restore-as-new-revision |
| Role conflict | Workspace roles: owner, admin, approver, editor, analyst, viewer |
| Notification overload | Per-user preferences, digesting, deduplication, and escalation policy |

## Automation and n8n

n8n is appropriate for orchestration and notifications, not for owning core transactional truth.

| Failure | Required design |
| --- | --- |
| Workflow crash | Durable run record, correlation ID, heartbeat, retryable state |
| Duplicate execution | Idempotency key at every side-effect boundary |
| Queue delay | Queue-age SLO, visible delayed state, autoscaling or throttling |
| Retry | Exponential backoff with jitter; classify transient versus permanent errors |
| Dead-letter | DLQ with payload reference, error code, attempts, owner, and replay action |
| Overlapping scheduled runs | Distributed lock or unique active-run constraint |
| Partial sync | Per-item checkpoints; do not rerun successful items blindly |
| Email failure | Notification outbox; channel fallback; failure must not roll back sync |
| Credential rotation | Secret manager reference, not copied secrets in workflow JSON |
| n8n database unavailable | Readiness fails, run pauses, alert; no destructive reset of the n8n schema |
| Recovery | Operator runbook, safe replay, and reconciliation after outage |

Core publish, prediction, and training jobs should use a durable queue such as managed Postgres jobs, SQS, Pub/Sub, RabbitMQ, or Redis Streams with persistence. n8n may call those APIs and notify operators.

## Security

| Risk | Production control |
| --- | --- |
| Unauthorized tenant access | RLS plus BFF authorization plus database invariant tests |
| Expired session | Typed 401, refresh once, preserve unsaved draft, redirect safely |
| API abuse | Per-user, tenant, IP, and route quotas; request size limits; anomaly alerts |
| Broad internal token | Per-service identity, mTLS or signed short-lived service token, rotation |
| n8n Code nodes can read process environment | Refactor secrets into scoped n8n credentials or a secret manager, then set N8N_BLOCK_ENV_ACCESS_IN_NODE=true; otherwise any editable workflow code can read deployment secrets |
| Meta tokens in environment JSON | Encrypted connection registry and secret manager; one credential per brand |
| Sensitive concept sent to Gemini | Consent, admin disable switch, redaction, retention and DPA |
| Model artifact compromise | Signed hash, restricted write role, promotion approval |
| Query-string tokens | Never send secrets in URLs or logs |
| Audit tampering | Append-only writer role; deny update/delete except retention procedure |
| Hard deletion | Soft lifecycle plus legal retention/erasure workflow |
| CSRF and browser hardening | SameSite cookies, origin checks, CSP, secure headers |
| Supply-chain risk | Locked dependencies, SBOM, vulnerability scans, provenance |
| Backup exposure | Encryption, least privilege, tested restore, access audit |

Never log captions, concepts, tokens, or provider payloads by default. Use correlation IDs and structured safe error codes.

## Scalability

| Concern | Required architecture |
| --- | --- |
| Thousands of brands | Connection registry, partitioned job scheduling, paginated APIs, brand-scoped indexes |
| Thousands of predictions daily | Stateless horizontally scaled BFF and inference pods, autoscaling, model cache |
| Concurrent users | Admission control, idempotency, optimistic concurrency, connection pools |
| Database pressure | PgBouncer, bounded pools, query timeouts, composite/partial indexes, pagination |
| Model cache | LRU and TTL, per-key download lock, atomic temp rename, checksum, prewarm |
| Result cache | Exact tenant/input/model/extractor/calibration/timezone key |
| Meta rate limits | Per-account token bucket, provider retry-after, adaptive scheduling |
| Background work | Durable queue, leases, heartbeats, DLQ, backpressure |
| Large history | Cursor pagination, archival policy, partition observations by time |
| Multi-region | Define data residency, single-writer strategy, clock/correlation semantics |
| Observability | RED metrics, traces across BFF/ML/n8n/Meta, logs with correlation ID |

Initial Predict service target:

- Warm core inference P95 at or below 750 ms
- Warm core inference P99 at or below 1.5 seconds
- End-to-end prediction P95 at or below 2 seconds
- Explanation P95 at or below 3 seconds
- 50 requests per second sustained for 15 minutes
- 100 requests per second burst for 60 seconds
- Less than 0.1 percent unexpected error rate
- Zero duplicate result rows under retries and concurrency

## Hidden edge cases

- Browser clock is wrong.
- Schedule crosses midnight after timezone conversion.
- DST rule changes after a future schedule was saved.
- Meta webhook is replayed after a database restore.
- Publish succeeds but the HTTP response is lost.
- Account reconnect points to a different Instagram business identity.
- Username changes while immutable account ID stays the same.
- A brand is merged, transferred, or deleted.
- A user loses permission after approving but before job execution.
- Draft is deleted while media upload or prediction is in flight.
- Model promotion and rollback happen repeatedly during cache warmup.
- Latest artifact exists but is only partially uploaded.
- Backup restore replays outbox events.
- Schema migration succeeds on one service and fails on another.
- Caption uses Arabic, CJK, combining marks, family emoji, or zero-width joiners.
- Meta omits a metric for one media type but returns zero for another.
- Multiple posts reuse the exact caption.
- A viral post changes cohort thresholds for every brand.
- Paid engagement or giveaway campaigns distort labels.
- The same campaign has variants that cannibalize each other.
- Legal deletion conflicts with model reproducibility and audit retention.
- Notification storms hide the one actionable incident.
- LLM provider changes model behavior without changing a friendly model name.
- Recommendation is applied after the source prediction became stale.
- Archived prediction is referenced by a calendar item.
- Two successor requests race against one parent.
- Candidate training uses an outcome that had not matured at the training cutoff.

## Findings ranked by severity

### Critical

1. Raw Random Forest scores are not calibrated probabilities and need abstention.
2. Prediction POST lacks server-side idempotency and request recovery.
3. No shared content item and immutable revision architecture connects Calendar, Predict, approval, and publication.
4. Calendar is not a publishing engine, despite schedule-like product language.
5. Engagement observations are overwritten rather than maturity-versioned.
6. Training runs in process-local background tasks instead of a durable queue.
7. Model activation has an operational majority-baseline gate plus a separate thesis scientific gate, but still lacks explicit candidate/champion state, regression against the current champion, and one-click rollback.
8. Unsigned joblib deserialization creates an artifact supply-chain risk.
9. Browser and Python feature extraction can disagree.
10. Exact prediction-to-publication linkage is incomplete end to end.
11. No robust timezone contract exists across UI, sync, inference, and training.
12. Core APIs lack enterprise idempotency, quotas, and rate limiting.

### High

1. Global MDI is insufficient as a local explanation.
2. Counterfactuals need support checks and non-causal contracts.
3. Calendar prediction_id is not wired by the product flow.
4. Visual Concept and Calendar Content Details are disconnected and ephemeral.
5. AI outputs still lack durable prompt/model/input lineage across sessions;
   thesis-scope client request snapshots and stale-response guards are not an
   enterprise audit store.
6. Sync uses current mutable metrics instead of observation snapshots.
7. Meta credentials are not stored in a scalable connection registry.
8. One broad internal token creates a large trust boundary.
9. No optimistic concurrency or workspace role model.
10. APIs need typed errors, deadlines, cancellation, and correlation IDs.
11. Model cache lacks bounded eviction, locks, checksum, and rollback invalidation.
12. Niche cohorts need concentration and minimum-brand controls.
13. History cannot yet guide a provisional result through time finalization.
14. Calendar attachment needs same-owner, same-brand, and input-hash validation.
15. Audit storage needs a dedicated append-only writer and retention process.
16. n8n currently permits Code nodes to read deployment environment variables and must be hardened before untrusted editors receive workflow access.

### Medium

1. Cursor pagination and N+1 query cleanup are required.
2. Browser security headers and CSRF defense need a release test.
3. AI and sync cost dashboards are missing.
4. Operator and user notification preferences are missing.
5. Calendar field naming and exports are inconsistent.
6. Backup, restore, and disaster-recovery drills are undocumented.
7. Accessibility, keyboard, screen reader, and reduced-motion testing need formal gates.
8. Mobile tables and dense enterprise histories need dedicated UX testing.
9. Model and data cards are missing.
10. Post-publish caption edits need a documented feature policy.

### Low

1. Remove obsolete Compose file version syntax when the n8n environment-access policy is hardened in the same reviewed deployment change.
2. Align documentation inventories and terminology.
3. Rename ambiguous fields such as Gemini content_type and Calendar content_details.
4. Improve empty-state guidance and operator runbook links.
5. Add product-level status pages and maintenance banners.

## Recommended production architecture

Request path:

Client  
to authenticated BFF and quota gate  
to prediction request plus idempotency store  
to active deployment snapshot  
to versioned feature service  
to support and abstention gate  
to calibrated inference  
to immutable prediction result  
to explanation and recommendation worker  
to result retrieval by request ID

Lifecycle path:

Content item  
to immutable content revision  
to approval bound to revision  
to publication job through transactional outbox  
to Meta publication and webhook reconciliation  
to immutable external media ID  
to append-only engagement observations  
to mature training dataset snapshot  
to candidate training and evaluation  
to approved champion deployment

Infrastructure:

- Next.js BFF remains the browser trust boundary.
- FastAPI inference is stateless and horizontally scalable.
- PostgreSQL is transactional truth.
- Supabase Auth and RLS enforce tenant boundaries.
- A durable queue owns long-running prediction explanation, publish, sync, and training work.
- n8n orchestrates schedules and notifications but does not own state.
- Object storage holds signed immutable artifacts.
- A model registry owns candidate, champion, retired, and rolled-back deployments.
- OpenTelemetry connects BFF, ML, worker, n8n, Meta, and database traces.

## Release gates

Before enterprise launch:

1. Apply both Supabase migrations in order and run fresh plus upgrade-path tests.
2. Implement idempotent prediction requests and lost-response retrieval.
3. Calibrate probabilities and add abstention.
4. Make backend feature extraction authoritative and pass multilingual parity tests.
5. Add content items and revisions; connect Calendar and Predict.
6. Implement exact publication and immutable media linkage.
7. Replace mutable engagement rows with observation snapshots and maturity windows.
8. Replace process-local training with a durable queue.
9. Add candidate/champion deployment, artifact signing, and rollback.
10. Add IANA timezone handling end to end.
11. Add per-tenant quotas, service identities, and secret management.
12. Run RLS isolation, concurrency, chaos, load, accessibility, and restore tests.
13. Verify every user-visible claim against the actual feature manifest.
14. Complete incident, replay, rollback, and data-deletion runbooks.

The correct product position today is “metadata and caption-structure performance tier prediction with optional creative AI assistance.” It should not claim to assess visual quality, video execution, reach, sales, or causal uplift until those capabilities are trained, validated, versioned, and monitored.
