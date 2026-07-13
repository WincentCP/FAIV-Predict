# FAIV Predict — Final Implementation Plan (Backend)

Date: 13 July 2026
Basis: `docs/FINAL_AUDIT_REPORT.md` (backend audit). Frontend work is deliberately excluded — the UI will be rebuilt, so this plan hardens the backend contract the rebuild will stand on.

Guiding rule: **no feature creep.** Every task below either removes a defense risk, strengthens the Predict contribution, or freezes the API contract for the rebuild. Anything not listed here should not be built before the defense.

---

## Phase 0 — Repair self-checks and evidence hygiene (do first; ~half a day)

### T0.1 Fix the failing readiness contract
- **Objective:** `python scripts/verify_thesis_readiness.py` passes again on the thesis machine.
- **Description:** In `scripts/verify_thesis_readiness.py`, add `evidence` to `ignored_markdown_parts` (the script currently fails whenever the README's own evidence-export workflow has been followed), and update `expected_markdown_paths` to the deliberate final documentation set — including `docs/FINAL_AUDIT_REPORT.md`, `docs/FINAL_IMPLEMENTATION_PLAN.md`, and a decision on `FAIV_Predict_Stitch_Prompts.md` (add it to the set if it stays in the repo; otherwise move it out of the repo root).
- **Reasoning:** A self-check that fails on the demo machine is the cheapest possible thing for an examiner to discover and the most avoidable.
- **Expected benefit:** Clean preflight; the verification story stays credible.
- **Affected modules:** `scripts/verify_thesis_readiness.py`; possibly file moves.
- **Complexity:** Low. **Priority:** Critical. **Order:** 1.

### T0.2 Evidence file hygiene
- **Objective:** One unambiguous source of truth for model evidence.
- **Description:** Rename `docs/FINAL_MODEL_EVIDENCE.md` to `docs/ARCHIVED_PRE_PLAN_MODEL_EVIDENCE.md` (it is already disclaimed as historical) and update references in `docs/IMPLEMENTATION_COMPLETION_REPORT.md` and the readiness script's expected set. Add `supabase/.temp/` to `.gitignore`.
- **Reasoning:** Two files named `FINAL_MODEL_EVIDENCE.md` with different numbers is a citation accident waiting to happen under defense pressure.
- **Expected benefit:** Impossible to quote the stale evidence by mistake.
- **Affected modules:** `docs/`, `.gitignore`, readiness script.
- **Complexity:** Low. **Priority:** Critical. **Order:** 2.

### T0.3 Restore local frontend toolchain (verification only, not UI work)
- **Objective:** `npm test` and `npx tsc --noEmit` pass locally.
- **Description:** Run `npm ci` in `frontend/` — `vitest` is declared but missing from the installed `node_modules`, so tests and the type check fail on this machine today (CI is green because it installs fresh).
- **Reasoning:** The BFF routes live in the frontend package; even with the UI being rebuilt, the backend-for-frontend layer must remain testable on the demo machine.
- **Expected benefit:** Full local green across both stacks; preflight claims stay true.
- **Affected modules:** none (dependency install only).
- **Complexity:** Low. **Priority:** Critical. **Order:** 3.

---

## Phase 1 — Freeze and align the backend contract (the rebuild's foundation; ~1–2 days)

### T1.1 Write the BFF API contract document
- **Objective:** A rebuilt frontend can be built (and reviewed) against exact response shapes without reading route source.
- **Description:** Create one `docs/API_CONTRACT.md` covering every `/api/*` route: request fields, response JSON shape, status codes, and — critically — the semantic notes a UI must not get wrong: (a) prediction tiers vs. realized tiers vs. live-history tiers on `/api/instagram-posts` are three different semantics; (b) raw class scores are uncalibrated; (c) `evaluation_status` (`validated`/`exploratory`) must gate claim language; (d) `observation_status` and `verification_badge` enums; (e) counterfactual fields and their disclaimers. Derive it from the code, not from memory.
- **Reasoning:** The audit found the backend contract is good but only documented as prose; the two tier semantics (finding P-3) are exactly the kind of thing a rebuild conflates.
- **Expected benefit:** The rebuild cannot silently break the honesty guarantees the backend worked hard to provide; the document also doubles as a thesis appendix.
- **Affected modules:** `docs/` only (plus readiness-script expected set).
- **Complexity:** Medium (breadth, not difficulty). **Priority:** High. **Order:** 4.

### T1.2 Align `/api/brands` model-scope with the loader's serving predicate
- **Objective:** "Ready" in the brands endpoint means `/predict` will actually serve.
- **Description:** In `frontend/app/api/brands/route.ts`, extend the models query filter to match `ModelLoader.get_model_metadata`: require `metrics->evaluation_contract IN ('faiv-thesis-v1','faiv-thesis-v2')` and `metrics->promotion_gate->passed = true` (via `.contains("metrics", { promotion_gate: { passed: true } })` plus contract check, or a small RPC/view shared by both).
- **Reasoning:** Audit finding B-2 — the BFF can report an active scope for a model the loader refuses, producing a "ready" brand whose prediction 503s.
- **Expected benefit:** No contradictory readiness states during the demo or after the rebuild.
- **Affected modules:** `frontend/app/api/brands/route.ts` (and `app/api/dashboard/route.ts` + `app/api/models/route.ts` if the same loose filter appears there — verify while editing).
- **Complexity:** Low. **Priority:** High. **Order:** 5.

### T1.3 Persist a truthful `storage_url`
- **Objective:** No dead `/object/public/...` URLs for a private bucket in the `models` table.
- **Description:** In `train_pipeline.upload_to_supabase_storage`, return the authenticated-path form (`.../object/authenticated/models/<path>`) or store `NULL` and rely on `storage_path` (the loader already reconstructs the URL). Keep backward compatibility in the loader.
- **Reasoning:** Audit finding B-3 — a schema reader (examiner or successor developer) will reasonably conclude the bucket is public.
- **Expected benefit:** Registry rows describe reality; one less awkward question.
- **Affected modules:** `ml-service/app/train_pipeline.py`, `ml-service/app/model_loader.py`, one test.
- **Complexity:** Low. **Priority:** Medium. **Order:** 6.

---

## Phase 2 — Strengthen the Predict contribution (the highest-value substance; ~2–4 days)

### T2.1 Evidence-gated counterfactuals
- **Objective:** "What to try" ranks by measured evidence, not noise.
- **Description:** The trained bundle already persists `evaluation.holdout_permutation_importance`. In `build_counterfactuals` (`ml-service/app/predict.py`), attach to each probe the corresponding feature's mean holdout permutation importance as `evidence_weight`, plus a derived `evidence_level` (`supported` when mean > 0 beyond std, `weak` otherwise). Sort primarily by evidence level, then by `delta_high`. Keep all probes in the response (transparency), and extend `counterfactuals_note` to explain the gating. Update tests.
- **Reasoning:** Audit finding P-1 — today the API's top recommendation can be a feature its own holdout evidence says carries no signal, which directly contradicts the project's scientific framing and is an obvious examiner attack.
- **Expected benefit:** The recommendation surface becomes internally consistent with the evaluation evidence — this converts the toughest defense question (Q2) into a strength.
- **Affected modules:** `ml-service/app/predict.py`, `ml-service/tests/test_api.py`, API contract doc.
- **Complexity:** Medium. **Priority:** Critical (for the defense narrative). **Order:** 7.

### T2.2 Concept-stage prediction (caption optional)
- **Objective:** A specialist with only a concept — the actual moment of need — can get an ML estimate before writing a caption.
- **Description:** Mirror the proven unknown-hour mechanism for captions: allow `caption: null` in `PredictionRequest` (keep the 1–2,200 rule when present). When absent, fill caption-shape features (`caption_length`, `hashtag_count`, `has_cta`, `has_question`, `emoji_count`) from the artifact's training medians/modes (extend `feature_reference_values` at training time to include `has_cta_mode`, `has_question_mode`, `emoji_count_median`), force the result `provisional`, record `caption_known: false` in the stored features and `prediction_context`, and suppress caption-dependent counterfactuals. BFF: accept the null caption, pass it through, and adjust the supersession comparison so adding a caption later yields an `inputs_changed` successor. Existing bundles that lack the new reference values simply keep requiring a caption (graceful degradation, same pattern as legacy hour support).
- **Reasoning:** Audit finding P-2 — the single largest problem–solution gap: the system claims pre-production support but demands a finished caption. All the machinery (provisional states, scenario bases, supersession) already exists; this is composition, not invention.
- **Expected benefit:** The Predict feature genuinely serves the pre-production workflow; the thesis gains a clean "graduated certainty" story (concept → caption → time → published → observed) that no examiner question undermines.
- **Affected modules:** `ml-service/app/shared.py`, `ml-service/app/predict.py`, `ml-service/app/train_pipeline.py` (reference values), `frontend/app/api/predict/route.ts`, tests, API contract doc. Requires one retraining run to produce bundles with the extended reference values.
- **Complexity:** Medium–High. **Priority:** High (do it if — and only if — there is time to retrain and test before the freeze; otherwise document it as designed future work and defend with the unknown-hour analogy).
- **Order:** 8.

### T2.3 Expand and test the CTA lexicon
- **Objective:** The `has_cta` feature reflects real Indonesian/English Instagram CTA usage.
- **Description:** Extend `CTA_PATTERN` in `ml-service/app/preprocessing.py` with documented, curated additions (e.g., "link di bio", "cek", "komen", "simpan", "swipe", "tap", "dm", "wa", "klaim", "kepoin") and add unit tests for true/false positives. Note: models must be retrained for the feature change to take effect, and the training-code hash will change — re-export evidence afterward (this is exactly what the hash system is for; do it together with T2.2's retrain, or not at all).
- **Reasoning:** Audit finding M-2 — a model feature and a recommendation lever rest on a 19-word list.
- **Expected benefit:** More truthful CTA detection; a ready answer to "how do you detect CTAs?".
- **Affected modules:** `ml-service/app/preprocessing.py`, tests, retrain + evidence re-export.
- **Complexity:** Low (code) but forces retraining. **Priority:** Medium — bundle with T2.2's retrain; skip if no retrain happens.
- **Order:** 9.

---

## Phase 3 — Defense-day operational readiness (~half a day, calendar-bound)

### T3.1 Final frozen evidence cycle
- **Objective:** The numbers in the thesis are the numbers the system serves.
- **Description:** After Phases 1–2 are frozen: run the full sync/retrain (`POST /sync/now`), re-export `evidence/FINAL_MODEL_EVIDENCE.{md,json}`, run `cumulative_er_sensitivity` and `data_volume_report` against the same frozen database, run `thesis_preflight.ps1` and archive its passing output, and verify the training-code hash in the export matches the source (the audit verified today's match; any Phase-2 code change breaks it until retrained).
- **Reasoning:** The evidence chain is the thesis's strongest asset; it is only an asset while the hashes line up.
- **Expected benefit:** Every empirical claim in the thesis traces to an archived, hash-bound artifact.
- **Affected modules:** none (operational).
- **Complexity:** Low. **Priority:** Critical. **Order:** 10 (last code-adjacent step).

### T3.2 Token and automation dry run
- **Objective:** No live-demo surprises.
- **Description:** Remint Meta tokens within 48h of the defense; run the n8n health branch manually; confirm both workflow branches execute; rehearse the offline fallback from `docs/DEFENSE_DEMO_SCRIPT.md` once with Wi-Fi disabled.
- **Reasoning:** Token expiry is the most common live-demo failure mode and is fully preventable.
- **Expected benefit:** Demo resilience.
- **Complexity:** Low. **Priority:** Critical. **Order:** 11.

### T3.3 Run the user evaluation sessions (if at all feasible)
- **Objective:** Replace "protocol exists" with even a small formative result.
- **Description:** Execute `docs/USER_EVALUATION_PROTOCOL.md` with 3–5 real participants; report honestly whatever comes out.
- **Reasoning:** "Did users understand it?" is a guaranteed question; three real SUS scores beat a perfect unused protocol.
- **Expected benefit:** Converts the weakest defense answer from "pending" to "measured."
- **Complexity:** Low technically; calendar-bound. **Priority:** High. **Order:** parallel to everything.

---

## Explicitly NOT in this plan (resist the temptation)

- Fixed-horizon engagement snapshots, calibrated probabilities, prediction intervals — stated future work; correct scope boundary.
- Public Meta OAuth, token refresh, publishing — out of scope by design.
- Queue/worker infrastructure, connection pooling, horizontal scaling — documented limits, appropriate at thesis scale.
- New Gemini capabilities or trend feeds — the advisory layer is already at the right size.
- Any frontend work — the rebuild consumes the contract frozen in Phase 1; building UI now would be wasted twice.

## Order of execution summary

| # | Task | Priority | Complexity |
| --- | --- | --- | --- |
| 1 | T0.1 Fix readiness contract | Critical | Low |
| 2 | T0.2 Evidence hygiene | Critical | Low |
| 3 | T0.3 `npm ci` toolchain | Critical | Low |
| 4 | T1.1 API contract doc | High | Medium |
| 5 | T1.2 Brands↔loader predicate alignment | High | Low |
| 6 | T1.3 Truthful storage_url | Medium | Low |
| 7 | T2.1 Evidence-gated counterfactuals | Critical | Medium |
| 8 | T2.2 Concept-stage prediction | High | Medium–High |
| 9 | T2.3 CTA lexicon (bundle with retrain) | Medium | Low |
| 10 | T3.1 Final frozen evidence cycle | Critical | Low |
| 11 | T3.2 Token/automation dry run | Critical | Low |
| — | T3.3 User evaluation (parallel) | High | Low |

If time runs short, the minimum defensible cut is: **Phase 0 + T1.2 + T2.1 + Phase 3.** T2.2 is the most valuable single improvement but the only one safe to drop, because its absence can be defended verbally with the unknown-hour design as the proven template.
