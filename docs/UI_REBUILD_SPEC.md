# FAIV Predict — UI Rebuild Spec (Stitch Reconciliation)

Date: 13 July 2026
Input: 8+ Stitch-generated HTML screens (Sign in, Home ×2, Predict input ×2, Predict result, Planner ×2, Results ×2, Brands ×2).
Purpose: one authoritative screen-by-screen spec that (a) resolves conflicts between duplicate Stitch variants, (b) **removes every fabricated capability** the backend does not have, and (c) maps every UI element to a real API field so the rebuild cannot silently break the honesty guarantees.

Rule of this spec: **if a UI element cannot name its API field, it does not ship.** An examiner who sees one fabricated number ("AI was 95% accurate", "Pred: 1.1k likes") will distrust every real number in the thesis.

---

## 0. Hard rejections (fabricated capabilities in the Stitch exports)

| Stitch element | Why it must go | Replace with |
| --- | --- | --- |
| **Upload dropzone** ("Drag and drop your creative here", JPG/PNG/MP4) | The system never inspects media — this is a stated thesis boundary | Text-first compose form (the other Predict variant) |
| **Per-metric predictions** ("Pred: 1.1k likes / 80 comments / 30 shares") | Model predicts one 3-tier class, never metric counts | Predicted tier vs realized tier chip (`verification_badge`) |
| **"AI was 95% accurate" per post** | No per-post accuracy exists | "Predicted High · Got High ✓" from `realized_tier` + `tier_error` |
| **"Boost: Add trending audio +12", "on-screen text +8"** | Audio/visual features are not model inputs | Real counterfactuals only: posting hour, CTA, hashtag count, caption length, format, weekend (`counterfactuals[]`) |
| **"Suggested Tags" panel** | No hashtag-suggestion endpoint | Cut (hashtag *count* probe exists in counterfactuals) |
| **"Estimated to reach top 10% of audience"** | No reach estimation; likes+comments ER only | "Expected High engagement vs this brand's history" |
| **"Est. Engagement Rate" as a predicted number** | ER is observed after publication, never predicted as a number | Tier + relative model score |
| **Follower "Next Milestone 50K, 90%" progress bars** | Not a feature | Cut |
| **"Engagement Rate 4.2% +0.5%" / "Follower growth +12%" trend charts** | Backend explicitly refuses recent-ER trends (age confound); no follower time series | Model accuracy trend (`accuracyTrend`) and/or format-mix momentum (`brand_history_momentum`) |
| **"Confidence score: High (89%)"** | Scores are uncalibrated; "confidence %" wording is banned | "Balanced accuracy 46% vs 33% baseline" + Reliable/Still-learning chip |
| **"Reconnect IG" button on brand card** | IG binding is operator-side (`IG_BRANDS_JSON`), no user OAuth | Read-only connection status + "contact operator" hint |
| **"Refresh data" button** | `/sync/now` is internal/n8n-only; users cannot trigger sync | "Retrain model" (real: `POST /api/train`) + last-synced timestamp |
| **"Analyzing…" async state on drafts** | Prediction is synchronous; no background analysis | Tier chip, provisional chip, or "Not predicted yet" |
| **Date-range picker "Oct 1 – Oct 31"** | No date-range filtering endpoints on results | Brand filter + existing lifecycle filters |
| **Settings nav item** | No settings surface exists or is planned | Cut; theme toggle lives in the user menu |

## 1. Resolved duplicates (which variant wins)

| Screen | Winner | Loser & why |
| --- | --- | --- |
| Predict input | **Two-panel "New Prediction"** (form left, result/empty-state right) | Upload-dropzone variant — impossible capability |
| Planner | **Month grid + right "Unscheduled Drafts" panel** | Week view — pretty but duplicates effort; month matches `calendar_entries` model and import/export workflows |
| Results | **Tabbed Published / Predictions with card grid + right detail drawer** | "Pred: 1.1k likes" variant — fabricated metrics |
| Brands | **Card grid with model-status chip + connection status** (merge of both) | Neither alone; take status chips from v1, sync/last-synced row from v2, drop milestones/reconnect |
| Home | **Merge**: stat row + recent predictions list + Predict CTA panel | Drop Brand Health charts (fabricated trends) and view-count gallery |

## 2. Design system decisions

- **Palette**: adopt the Stitch M3 token set as-is (primary `#6343a4`, `primary-container #7c5cbf`, surfaces `#fef7ff`/`#f8f1fb`/`#f2ecf5`, error `#ba1a1a`) — all 8 screens already share it. It supersedes the older `#7C5CBF`-primary from the prompt pack. Implement as CSS variables in `globals.css` + Tailwind config, **not** CDN script config.
- **Semantic tier colors** (Stitch used ad-hoc hexes; standardize): High `#137333` on `#e6f4ea`; Average `#b06000` on `#fef7e0`; Low/miss `#c62828` on error-container; Provisional/attention amber. Define once as tokens (`--tier-high-*` etc.).
- **Typography**: Plus Jakarta Sans (already local via Fontsource — keep; no Google Fonts CDN). Scale: display-lg 48/700, headline-lg 32/700, headline-md 24/600, headline-sm 20/600, body 16/400, label-md 14/600, label-sm 12/500.
- **Icons**: keep **Lucide** (already installed); do not add Material Symbols font. Map: auto_awesome→Sparkles, bar_chart→BarChart3, calendar_month→CalendarDays, groups→Users, home→Home, schedule→Clock, check_circle→CheckCircle2, trending_up→TrendingUp.
- **Layout tokens**: sidebar 240px, topbar 72px, page margin 32px, gutter 24px, container max 1200px, radius 16px cards / 12px inputs / full pills, ambient shadow `0 10px 30px rgba(124,92,191,0.08)`.
- **Nav = 5 items**: Home, Predict, Planner, Results, Brands. Active state: bold primary + 4px left border + tinted bg (as in Stitch). Mobile: bottom nav with the same 5 (Stitch shows 4 — add Planner).
- **No Tailwind CDN, no external images.** All Stitch `lh3.googleusercontent.com` placeholders are replaced by real Instagram thumbnails (`thumbnail_url`/`media_url` from `/api/instagram-posts`) or initial-letter avatar blocks.
- **Score ring**: reusable `<ScoreRing value={confidence}>` — always captioned "relative model score, not a probability". Ring color = tier color of the predicted class, not an independent green/teal scale (Stitch used teal for 94 — wrong signal).
- Motion: 150–250ms ease-out; ring fills once on result load; respect `prefers-reduced-motion` (already in globals).

## 3. Screen specs (element → API field)

### 3.1 Sign in (`/`)
Keep the Stitch glass split-card almost as-is. Left: "Know before you post." + decorative score ring. Right: email/password → existing Supabase `signInWithPassword`. Keep the "Accounts are created by your workspace admin" note (matches backend — no signup). Add real error/loading states from the current page logic.

### 3.2 Home (`/dashboard`)
Data: `GET /api/dashboard`, `GET /api/brands`, `GET /api/calendar`, `GET /api/instagram-health`.
- Greeting: "Good morning, {first segment of user email}" — fine.
- Stat card 1 — **Tier match rate**: `outcomeVerification.exactTierMatchRate` ("of {linkedMaturePredictions} verified posts matched"); secondary line `withinOneTierRate` "within one tier". Empty state when `linkedMaturePredictions === 0`: "No verified outcomes yet".
- Stat card 2 — **This week**: count of `calendar_entries` in current week + day dots (dot filled = entry exists that day).
- Stat card 3 — **Model status**: chip from active model `evaluationStatus`: `validated` → "Reliable" (green), `exploratory` → "Still learning" (blue), none → "Not ready" (neutral); subtitle "trained on {trained_samples} posts".
- Recent predictions list: `dashboard.recent` → mini ScoreRing (`confidence`), format icon (from features), caption, tier chip, relative time. "Outdated" row style for stale/superseded comes from History data if shown; otherwise omit strikethrough rows.
- Right CTA panel: keep, but copy = "Describe your next post to get a performance estimate" (icon: PenLine, **not** add_photo_alternate — no uploads). Button → `/predict`.
- Cut: Brand Health charts, Top Performing gallery (v2 can use `/api/instagram-posts` sorted by `er` with tier chips — real, but not required for defense).

### 3.3 Predict (`/predict`) — the flagship
Two-panel layout, single screen, no view switch (per prompt pack). Left column (form, ~5/12):
- Brand select (from `/api/brands`) + `ModelMaturity` line ("Uses this brand's model" / "Uses the {niche} niche model" / "Not ready").
- Format segmented control (Reel / Carousel / Feed image) + note "Story and feed video not supported yet".
- Caption textarea with live `CaptionIntel` signals + n/2200 counter. (Stitch's decorative #hashtag chips inside the textarea: cut.)
- Publish date + optional time ("Add time" toggle; unset shows "Not set · provisional result").
- Collapsed accordions (Stitch had the right idea, wrong labels): **"Creative Brief (recommended)"** → existing `ConceptAssistant` + `BriefImporter` (paste script/notes → normalize). **"Current context & trend notes"** → existing `TrendInsights` (dated, sourced notes). NOT "Trending Topics".
- Collapsed **"Brand patterns"** → `BrandPatterns` snapshot (or place under result column).
- Primary button: "Get performance estimate" (not "Analyze Post" — keep one verb everywhere).

Right column (result, ~7/12):
- Empty state: keep Stitch's dashed-ring illustration; copy: "Your estimate will appear here. It compares caption, format, and timing with this brand's verified history." (no "reach/insights tailored to audience").
- Result state, top card: ScoreRing (`confidence`) + tier chip (`predicted_class`) + one-line reason (top `whyReasons`) + scope line "compared with {brand}'s verified history; uses likes+comments, not reach or sales".
- Amber banner when `prediction_context.status === "provisional"`: keep Stitch's "No time set — this is an early estimate" ✔ (this one was correct!).
- Small insight cards row: only measured facts — Best supported hour (from hour counterfactual `to_value`), caption length vs training median (`feature_reference_values`), hashtag count vs median. Never "Optimal ✓" as a verdict — show "yours 142 · brand median 480".
- **"What to try"** list = `counterfactuals[]`: icon per parameter, `change` text, `from_prob_high → to_prob_high` with `+delta_high` chip; Apply toggle only for `post_hour`; others "Edit manually". Subtitle: "One-change score tests from the model — relative clues, not guarantees." (After backend T2.1: sort/badge by `evidence_level`.)
- Creative review card (when brief present + reviewed): strengths / try-next / brand fit / trend adaptation from `/api/analyze-concept`, with "does not change the estimate" note and stale badge.
- Collapsed "Evidence & model details": raw class score bars (High/Average/Low `probabilities`), TrustStrip (`balanced_accuracy` vs `baseline_accuracy`, `test_samples`, version, evaluation chip), OOD warnings (`out_of_range`), MDI chart. Model line format: "Model {version} · balanced accuracy 46% vs 33% baseline · Still learning" — never "confidence 89%".
- Footer actions: "Save to plan" (`/api/calendar`), "Re-analyze" (supersession handled as today), "Edit draft".

### 3.4 Planner (`/calendar`)
Month grid (Stitch month variant) + right drawer.
- Cell cards: format icon, title (`creativeBriefSummary(content_details)` or caption), time or "Unscheduled", chip = prediction state: tier chip when `prediction.status === "current"`, amber "No time yet" for provisional, "Outdated — re-analyze" for stale, production `status` (Ready to Post etc.) as secondary chip. **Never "92% Predict"** — if a number shows, it's the ScoreRing with the standard caption.
- Right panel: selected entry details (Stitch's "Selected Post" card): tier + ring, caption, schedule, actions "Predict again" (→ `/predict?plan_id=`) and status controls; below it "Unscheduled drafts" list (entries with no `posting_time`… note: backend has no unscheduled *date*; drafts = entries whose `posting_time` is null → keep them in their date cell AND surface in the panel list).
- Keep existing import/export (CSV/XLSX/PDF), filters, drag-to-reschedule. Keep "Export plan to CSV" link.
- Thumbnails on plan cards: none (plans have no media) — use format icon block instead of Stitch's stock photos.

### 3.5 Results (`/results`, replaces Insights + History)
Top-left segmented tabs: **Published** | **Predictions** (per prompt pack).
- Summary strip (both tabs): "Tier match rate {exactTierMatchRate}%" · "Predictions {totalPredictions}" · "Verified outcomes {observedCount}" — from `/api/dashboard`. NOT "Avg. Accuracy 94%".
- Published tab: card grid from `/api/instagram-posts` (real thumbnails, date, `er`, tier chip from live percentiles labeled "vs brand history"); "Predicted X · Got Y" chip only when a linked prediction exists (`verification_badge`: match ✓ green / one_off amber / miss red). Detail drawer: media, **Prediction vs Result block** (predicted tier → realized tier, from `realized_tier` + basis tooltip), Key Metrics from `/api/instagram-post-insights` (reach/views/saves/shares — real Meta lifetime metrics; show "unavailable" honestly), and the **Link prediction** flow (`/api/publication-links`, mandatory confirm).
- Predictions tab: `/api/history` — version chains, status chips (current/provisional → "No time set"/stale → "Outdated"/superseded), observed outcome once mature, archive/restore.
- "Top Insight This Week" banner: cut, or replace with a real `brand-patterns` highlight ("Reels · median ER 4.2% · 38 posts · directional evidence") — only render when `eligible_for_highlight`.
- Drawer explanation sentence ("AI correctly identified strong visual contrast") — cut; the model never saw the visual. If a sentence is wanted: "Predicted from caption, format, and timing patterns."

### 3.6 Brands (`/brands`, merges Brands + Model Health)
Card per brand from `/api/brands` + `/api/instagram-health` + `/api/models`:
- Header: initial-letter avatar (no stock logos), name, niche chip, followers (real), connection dot (`connected`/`error`/`unreachable`/`unbound` — error states show "Ask your operator to check the Instagram connection", no Reconnect button).
- Status chip: `validated` → "Reliable", `exploratory` → "Still learning", none → "Not ready".
- Body line: "Trained on {trained_samples} verified posts · balanced accuracy {x}% vs {y}% baseline" (from `/api/models` metrics) — never "94% accurate last 30 days".
- Progress bar: repurpose as **data maturity toward personal model**: `samples / 200` ("{samples}/200 posts toward a personal model") — real and useful, replaces follower milestones.
- Actions: "Retrain model" (`POST /api/train` + job polling), "View evidence" (expand: confusion-matrix-lite, QWK, holdout size, evaluation gates — from `metrics`).
- "Add brand" card → existing create-brand flow (name, niche with `/api/classify` suggestions, profile summary). Copy: "Create a brand workspace" — NOT "Connect another Instagram account" (connection is operator-provisioned).
- Last synced row: real (`last_synced` from health). "Syncing… 45%" live progress: cut (sync is a scheduled batch; no progress API).

## 4. Missing from Stitch (must be designed into the build)

1. Creative Brief structured fields + paste-to-normalize importer (core differentiator — Stitch only drew a collapsed placeholder).
2. Brand Performance Snapshot panel (medians/IQR with evidence-level dots ●●○).
3. Trend notes CRUD (add note + source + date; stale badge).
4. Caption refine (Gemini) under a "Caption help" disclosure.
5. Publication-link confirmation dialog (Results → Published).
6. Glossary popovers for tier / relative score / provisional / still-learning.
7. Empty/error/degraded states everywhere (Stitch shows only happy paths): no brands yet, no model yet (503), Gemini not configured (501), Graph degraded fallback ("stored history" badge).
8. Retrain job progress (pending/running/success/failed from `/api/train?job_id=`).

## 5. Build order

1. Design tokens + AppShell (sidebar/topbar/mobile nav) — everything else sits on this.
2. Predict two-panel page (flagship; reuse existing logic/components, new skin).
3. Results (Published + Predictions tabs + drawer + link flow).
4. Home, then Brands, then Planner reskin (Planner logic mostly survives).
5. Redirects: `/insights`, `/history` → `/results`; `/niches`, `/model-health` → `/brands`; keep `/predict` param contracts (`plan_id`).
6. Update `frontend/tests` + run the full local gate (lint, tsc, vitest, build).

Vocabulary lock (from the prompt pack, enforced across all screens): provisional → "No time set yet" · stale/superseded → "Outdated — re-analyze" · exploratory → "Still learning" · validated → "Reliable" · OOD → "New territory for your data" · raw score → "Performance score" (never probability/confidence %) · counterfactuals → "What to try" with +N deltas.
