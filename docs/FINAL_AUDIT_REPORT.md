# FAIV Predict — Final Backend Audit Report

Date: 13 July 2026
Role assumed: independent thesis examiner, ML engineer, software architect, and QA engineer.
Scope of this audit: **backend only** — the FastAPI ML service, the Next.js BFF route handlers (the API contract a rebuilt frontend will consume), the Supabase schema/trigger/RLS layer, the sync/retrain pipeline, the n8n automation contract, and the evidence/verification tooling. The current frontend UI is explicitly out of scope because it is scheduled for a rebuild (see `FAIV_Predict_Stitch_Prompts.md`).

Everything below was verified against the actual source, not documentation claims. All 95 ML-service tests pass on this machine. The current training-code fingerprint (`b3df9ef9…`) matches the frozen evidence exports in `evidence/`, so the recorded model results are citable as produced by this exact code.

---

## 1. Executive Summary

The backend is **substantially mature and academically defensible**. The ML methodology is far above typical bachelor-thesis level: chronological splits, train-only percentile thresholds, majority and logistic baselines, expanding-window temporal folds with fold-local thresholds, holdout permutation importance, a two-gate promotion system (operational vs. scientific), and complete hash-bound evidence persistence. The data-integrity layer (immutable Instagram identity binding, one-to-one publication links, database-enforced realized-tier reconciliation under the serving model's frozen thresholds, append-only lifecycle events) is the strongest part of the whole project and should be presented as such.

The honest weaknesses are not engineering defects — they are **modeling-scope and problem-fit limits** that an examiner will press on:

1. The validated personal model is, by its own permutation-importance evidence, essentially an *"is this a Reel?"* detector (importance 0.149; every other feature ≤ 0.013 or negative). Yet the counterfactual API ranks and returns "what to try" deltas on features the same evidence says carry no holdout signal.
2. A prediction **requires a finished caption**, but the stated problem is *pre-production* decision support. A specialist with only a concept cannot get any ML signal today.
3. The niche-model floor of 30 pooled posts produces scientifically fragile models (the Fitness model: 57 posts, holdout of 12 with 9 HIGH, zero AVERAGE recall, still operationally promoted).

There are also several concrete, fixable engineering findings: the repository's own readiness check (`verify_thesis_readiness.py`) currently **fails**, the `/api/brands` model-scope report uses a looser serving predicate than the model loader, and two different "tier" semantics coexist across endpoints without a shared contract note.

**Verdict: READY, conditionally** — ready to defend once the Phase-0 items in the implementation plan are done (hours, not weeks), and provided the candidate defends the three scope limits above proactively instead of waiting to be asked.

---

## 2. Overall System Assessment (backend)

| Layer | Assessment |
| --- | --- |
| FastAPI ML service | Excellent. Clean router decomposition (`predict`, `train`, `instagram`, `patterns`), strict Pydantic contracts (`extra="forbid"`), timing-safe internal token, fail-closed model loading, no fabricated fallbacks anywhere. |
| Training pipeline | Excellent methodology for the scope. One centrally audited model factory; leakage-aware thresholds; rejected candidates never evict the previous model; full evidence persisted before the promotion decision. |
| Sync/reconciliation | Very good. Idempotent upserts keyed by `(brand_id, instagram_media_id)`, follower-denominator preservation, refusal to write fabricated 0% ER, `media_product_type='REELS'` required for Reel eligibility, row-lock serialization per brand. |
| Database contract | Outstanding. SECURITY DEFINER triggers make forged outcomes practically impossible: `actual_er` must equal a linked mature verified post's ER; `realized_class` must match the serving model's persisted P33/P67; legacy `actual_class` writes are rejected; every transition is audited append-only. |
| BFF API layer | Good. Consistent auth → ownership → validation → sanitized-response pattern; supersession-reason derivation is server-side and correct; upstream messages allowlisted. A few contract inconsistencies (see findings). |
| Automation | Adequate and honest about limits: synchronous `/sync/now`, in-process background training with 30-minute stale-job reconciliation, secret-free inactive n8n template. |
| Verification tooling | Strong idea, currently self-contradictory: the evidence-export workflow produces files that make `verify_thesis_readiness.py` fail (finding B-1). |

---

## 3. Problem–Solution Fit Analysis

The stated problem: social media specialists must judge, **before production**, whether a concept will perform — hook strength, storytelling, pacing, visual direction, brand fit, trend fit.

What the backend actually delivers:

| User question | Backend answer | Fit |
| --- | --- | --- |
| Will this content perform for this audience? | Relative 3-tier estimate vs. the brand's own verified history | Partial — honest, but driven mostly by format + timing + caption shape, not the creative idea |
| Is the concept/hook/storytelling strong? | Gemini creative review of the structured brief (advisory, separated from ML) | Fit by design, but it is an LLM opinion, not a measured signal — and the system says so, which is correct |
| Is the duration/pacing right? | Brief captures `durationSeconds`; not an ML feature | Advisory only |
| Does it fit the brand and its audience? | Brand Performance Snapshot (median ER/IQR by format, daypart, caption band, hashtags, CTA) + momentum windows | Good — genuinely useful descriptive evidence with sample-size guards |
| Is it aligned with current trends? | User-supplied dated, sourced trend notes; advisory only | Honest scope boundary, defensible |
| What should I improve before production? | Model counterfactuals + Gemini suggestions | Weakest link — see Predict review below |

The architecture handles the separation of these signals correctly (ML never contaminated by LLM output, briefs never enter the feature vector). The residual mismatch is that **the measured signal covers the least creative part of the decision** while the most creative part is covered by an unverified advisory. This is acceptable for a bachelor thesis *if stated as the core limitation and framed as the research boundary* — the README and defense kit already do this. Do not let the presentation imply the RF evaluates creative quality.

---

## 4. Predict Feature Review (backend)

Verified behavior of `POST /predict` (`ml-service/app/predict.py`):

**Correct and defensible:**
- Model resolution: newest promoted personal artifact → niche fallback derived from the *persisted* brand niche (not the caller's claim). Fail-closed provenance validation in the loader.
- Unknown posting time is handled honestly: scores are frequency-weighted over the training split's observed hours, marked `provisional`, with the scenario basis recorded in the response and in the stored features JSON. This is a genuinely good design.
- Persistence-before-response with ownership subquery and supersession validation inside the INSERT. A prediction the user never received cannot exist, and a response the user received is always durably recorded.
- `input_hash`, `feature_schema_version`, model identity, and raw class scores are all persisted — the immutable-snapshot claim is real.

**Findings:**

**P-1 (High, honesty of recommendations).** `build_counterfactuals` probes hashtag count, caption length, CTA, weekend, format, and hour, then ranks by `delta_high`. For the validated Lasence model, holdout permutation importance is: `is_reels` 0.149, `has_question` 0.013, `has_cta` 0.011, everything else ≈ 0 or negative (`caption_length` −0.034, `post_hour` −0.031). Deltas on zero/negative-importance features are model noise, yet the API returns them ranked as the top "measured improvements." The disclaimers exist, but ranking noise first undermines the system's own scientific framing. The backend should attach the feature's holdout permutation importance to each counterfactual (the artifact already stores the evaluation) so any frontend can de-rank or badge weak-evidence probes.

**P-2 (High, problem fit).** `PredictionRequest.caption` requires non-whitespace text; the BFF enforces the same. The primary persona's moment of need is *before* a caption exists. A "concept-stage estimate" mode (caption absent → caption-shape features at training medians, result forced `provisional` with an explicit `caption_known: false` basis, exactly parallel to the unknown-hour mechanism) would close the largest remaining gap between the problem statement and the implemented solution, reusing machinery that already exists. This is the single most valuable backend change available before the defense — but it is a scope decision, not a defect.

**P-3 (Medium).** Tier semantics differ across endpoints: `/instagram/posts` grades stored posts against *live whole-history percentiles*, while realized tiers on predictions use the *serving model's frozen thresholds*. Both are individually correct and labeled, but nothing in the API contract warns a client that "tier" means two different things. A rebuilt frontend is one naming accident away from presenting them as comparable.

**P-4 (Low).** The counterfactual response keeps only the best supported hour but returns every format switch, including formats the client's contract may fix (the user's real constraint). Harmless — format probes are informative — but the response could flag `format` probes as "informational" vs. "actionable."

---

## 5. Machine Learning Review

**Methodology (verified in `train_pipeline.py`): sound.** Chronological 80/20 split; P33/P67 computed on the training portion only; three-class integrity enforced (training aborts if percentile ties collapse a class); majority-class and scaled-logistic baselines; three expanding-window temporal folds, thresholds recomputed per fold; permutation importance on the untouched holdout; two-gate promotion; dataset SHA-256 over identities + features + labels (captions excluded); training-code and requirements fingerprints; runtime versions. The evidence chain is real: I recomputed the training-code hash and it matches the frozen exports.

**Results (must be presented honestly):**
- Lasence Bakeshop (account, 398/100 split): balanced accuracy 0.460 vs 0.333 baseline; macro-F1 0.405 vs 0.150; QWK 0.458; raw accuracy 0.41 vs 0.29 majority. Passed all scientific gates → `validated`. This is a modest but *real and honestly measured* improvement — defensible as long as no one claims high accuracy.
- Fitness (niche, 45/12 split): raw accuracy 0.833 is meaningless (9 of 12 holdout samples are HIGH; AVERAGE recall 0). Correctly gated `exploratory`. Do not cite its accuracy in the thesis except as an example of why the scientific gate exists — it is actually a great exhibit for the two-gate rationale.

**ML findings:**

**M-1 (High, justification needed).** The 30-post niche floor almost guarantees exploratory-quality models (holdout ≈ 6–12 samples for a 3-class problem). The 200-post personal floor is reasonable. The asymmetry (200 vs 30) needs a stated rationale in the thesis: cohort pooling exists for *coverage* (a young brand gets some signal) and the exploratory label is the compensating control. Without that framing, an examiner will read 30 as arbitrary.

**M-2 (Medium).** `has_cta` rests on a 19-word regex lexicon (`beli|dapatkan|…|follow`). It misses common Indonesian CTA idioms ("link di bio", "komen", "swipe", "cek keranjang") and over-matches generic words ("check", "share" in non-CTA use). Since `has_cta` is both a model feature and a counterfactual lever, lexicon quality directly shapes recommendations. Expanding and unit-testing the lexicon is cheap; at minimum, document it as a limitation.

**M-3 (Medium).** Cumulative-ER age confound: acknowledged everywhere, and the `cumulative_er_sensitivity` report exists with real output (Pearson r = 0.045 for Lasence — helpfully small; cite it). This is handled about as well as it can be within scope.

**M-4 (Low).** The emoji regex includes broad BMP symbol ranges (`☀-➿`, `⬀-⯿`) plus the variation selector; `emoji_count` will count dingbats and misc symbols as emoji. Given its near-zero importance this is cosmetic, but say "emoji/symbol count" if pressed.

**M-5 (Defense prep, not a defect).** Niche models pool cross-tenant data by design; the served artifact exposes pooled thresholds and reference medians to any brand in that niche. The correct one-sentence defense: only aggregate model parameters cross tenants, never rows, captions, or identities — and the dataset manifest is persisted only as a hash.

---

## 6. Business Logic Review

Verified consistent end-to-end:
- **Prediction lifecycle**: immutable snapshots; supersession reasons (`inputs_changed` / `time_finalized` / `manual_rerun`) derived server-side in the BFF by comparing the stored previous snapshot — not trusted from the client; one-successor-per-prediction enforced; 409 when superseding an already-superseded row.
- **Plan↔prediction links**: same owner and same brand enforced in BFF *and* in DB triggers; plan edits stale the linked prediction via trigger.
- **Publication→outcome**: explicit user confirmation required; one-to-one uniqueness both ways; outcome attachment only via SECURITY DEFINER reconciliation; maturity gate (7 days) enforced in SQL, not application code.
- **Training data**: predictions never become training labels; only verified Graph posts train models. This cleanly refutes the "self-fulfilling feedback loop" examiner attack.

**Findings:**

**B-1 (Critical, pre-defense).** `scripts/verify_thesis_readiness.py` **fails right now**: its expected-markdown contract lists exactly six files, but `FAIV_Predict_Stitch_Prompts.md` and the exported `evidence/*.md` files exist on disk. Worse, the tooling contradicts itself: the README instructs exporting evidence into `evidence/`, and the readiness script then fails because those exports exist. Fix the script's ignore set (add `evidence/`) and make a deliberate decision about the Stitch file and any new docs (add to the expected set or relocate). A failing self-check on the demo machine during a defense would be an own goal.

**B-2 (Medium).** `/api/brands` computes `active_model_scope` from models matching only `data_source` + `identity_key`, while `ModelLoader.get_model_metadata` additionally requires the `faiv-thesis-v1/v2` evaluation contract and a passed promotion gate. A legacy or partially registered model could make the BFF report "cohort"/"personal" readiness while `/predict` returns 503. Align the BFF filter with the loader's predicate (or expose one shared serving-eligibility view).

**B-3 (Low).** `train_pipeline.upload_to_supabase_storage` returns and persists a `/object/public/...` URL for a **private** bucket; the stored `storage_url` is a dead value and the loader independently reconstructs an authenticated URL. Harmless at runtime, but it will confuse the next maintainer and an observant examiner reading the schema. Persist the authenticated path form (or null) instead.

**B-4 (Low).** Two near-identically named evidence files exist (`docs/FINAL_MODEL_EVIDENCE.md` archived/stale, `evidence/FINAL_MODEL_EVIDENCE.md` current). The archived one is correctly disclaimed, but the naming invites citing the wrong file under defense pressure. Rename the archived one (e.g., `ARCHIVED_PRE_PLAN_MODEL_EVIDENCE.md`) or delete it.

---

## 7. Architecture Review

- Trust boundaries are correct and consistently enforced: browser → BFF (session + ownership), BFF → FastAPI (internal token, timing-safe), FastAPI → DB/Storage (privileged, server-only). No browser code can reach FastAPI or Gemini.
- The composition-root + routers split (`main.py` re-exporting for compatibility) is clean; the compatibility `__all__` is large but justified by test patching.
- Known and *documented* scale limits: synchronous `/sync/now`, per-operation psycopg2 connections, process-local model cache, in-process training tasks. All fine at thesis scale; all honestly listed in the README. No action needed beyond keeping them in the limitations chapter.
- Graph client is defensively written (bounded pagination, cursor recovery without trusting Meta's `next` URL to carry auth, hard caps).
- One genuine gap for the rebuild: **there is no single API-contract document for the BFF.** The README's endpoint table is good prose, but a rebuilt frontend needs the exact response shapes (especially the two tier semantics, `evaluation_status`, `observation_status`, `verification_badge`, counterfactual fields). Freezing this contract *before* the rebuild is cheap insurance.

---

## 8. Strengths (lead with these in the defense)

1. Database-enforced outcome integrity — users cannot manufacture success; even the service cannot attach an outcome that disagrees with a verified mature post.
2. The two-gate system with a live example of each gate outcome (Lasence validated, Fitness exploratory) — a built-in demonstration of scientific self-restraint.
3. Full reproducibility chain: dataset hash, training-code hash (verified matching today), requirements hash, runtime versions, frozen thresholds.
4. Honest uncertainty semantics: provisional predictions, uncalibrated-score labeling, OOD warnings, evidence levels on descriptive patterns.
5. Strict ML/LLM separation with prompt-injection-aware Gemini usage (untrusted-data framing, response schemas, output clamping).
6. 95 passing backend tests covering API contracts, research evidence, and schema rules.

## 9. Weaknesses (own them before the examiner does)

1. Predictive power is modest and format-dominated; counterfactuals currently outrank their own evidence (P-1).
2. Caption-mandatory inference contradicts the pre-production positioning (P-2).
3. Niche floor of 30 yields fragile models; the asymmetry needs an argued rationale (M-1).
4. The CTA lexicon is thin for the Indonesian market it targets (M-2).
5. No fixed-horizon engagement snapshots — cumulative ER confound is mitigated and measured, not eliminated (M-3, already documented).
6. User evaluation not yet run (protocol exists; results pending — never imply otherwise).

## 10. Remaining Risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Readiness script fails during final preflight demo | High | Phase 0 fix (B-1) |
| Frontend rebuild breaks against undocumented response shapes | High | Freeze the BFF contract first (A-1 in plan) |
| Examiner asks a counterfactual question and the demo shows a noise-ranked recommendation | Medium | P-1 fix or verbal framing |
| Meta token expiry on defense day | Medium | Already covered by health checks + offline demo script; remint tokens the day before |
| `/api/brands` says ready, `/predict` 503s during live demo | Low | B-2 fix |

## 11. Final Verdict

**READY (conditional).** The backend is coherent, honest, and unusually rigorous for the level. The conditions are the Phase-0 items (fix the failing self-check, evidence-file hygiene, contract alignment) and a defense narrative that leads with the integrity/evidence architecture while proactively owning the modeling-scope limits. If P-2 (concept-stage prediction) lands, the problem–solution story becomes genuinely strong rather than merely defensible.

---

## 12. Toughest Defense Questions (and the answers a strong candidate gives)

**Q1. Your validated model's permutation importance says only `is_reels` matters. Isn't your system just telling users "post Reels"?**
Strong answer: "For this brand's history, format is genuinely the dominant measurable signal, and the model correctly discovered that instead of inventing signal — the logistic baseline agrees. That is itself a finding: metadata-level features carry limited signal beyond format, which motivates the creative-brief layer and defines future work (fixed-horizon outcomes, content semantics). The system reports importance honestly rather than hiding it."

**Q2. Why should I trust a 'what to try' suggestion built on a feature with zero holdout importance?**
Strong answer: "You shouldn't treat it as evidence, and the product says so — deltas are labeled model-sensitivity tests, not causal uplift. [After P-1:] Each probe now carries its measured holdout importance, and low-evidence probes are de-ranked." Without P-1, the honest answer is to concede the ranking should be evidence-gated and describe the fix.

**Q3. Your users decide before a caption exists. Why does your predictor require a caption?**
Strong answer if P-2 shipped: "It no longer does — concept-stage estimates score the known inputs and mark caption-shape features as unknown, exactly like the unknown-hour mechanism, and the result is provisional until the caption is final." Otherwise: acknowledge it as the identified next step and show the unknown-hour design as the proven template.

**Q4. 41% accuracy on three classes — why is this useful?**
Strong answer: "Raw accuracy is the wrong headline for imbalanced ordinal classes; balanced accuracy 0.46 vs 0.33, macro-F1 0.405 vs 0.150, QWK 0.458, positive gains in all three temporal folds. It is a decision-support signal against an honest baseline, not an oracle — and the UI language never promises probability."

**Q5. Why 200 posts for a personal model but only 30 for a niche model?**
Strong answer: coverage vs. confidence trade-off — the niche floor exists so young brands get *some* scoped signal, and the scientific gate + exploratory labeling is the explicit control that keeps weak pooled models from being over-claimed. Concede the number is a pragmatic floor, not derived from a power analysis.

**Q6. Old posts have had years to accumulate engagement. Doesn't cumulative ER corrupt your labels?**
Strong answer: cite the sensitivity report — for the main brand, age vs. ER correlation is r ≈ 0.045, the age-strata medians overlap, and excluding the oldest 20% is evaluated; the limitation is real, measured, and bounded, with fixed-horizon snapshots as stated future work.

**Q7. Could a user fake a successful prediction outcome?**
Strong answer: walk the trigger chain — outcomes can only be attached by the SECURITY DEFINER reconciliation from a verified, mature, same-brand Graph post linked one-to-one with explicit confirmation; even a privileged UPDATE that disagrees with the linked post's ER or the serving model's thresholds is rejected at the database layer.

**Q8. Does the niche model leak other clients' data?**
Strong answer: only aggregate parameters (a fitted forest, pooled thresholds, medians) cross tenants; no rows, captions, or identifiers are served, and evidence persists the dataset only as a hash.

**Q9. Gemini writes captions and the model scores captions. Isn't the loop circular?**
Strong answer: no output of Gemini changes a score unless the user applies it and requests a new prediction, which creates an auditable successor version; and predictions never feed training. The loop is user-mediated and versioned.

**Q10. What would falsify your system's usefulness?**
Strong answer: the realized-tier verification aggregate — exact-match and within-one-tier rates on linked mature publications are computed and displayed; if those stay at chance level as links accumulate, the historical estimate is not useful for that brand. The mechanism to detect failure is built in.
