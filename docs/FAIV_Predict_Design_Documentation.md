# FAIV Predict — UI/UX Design Documentation

> Design review & feature validation document for the **FAIV Predict** web dashboard.
> Stack: Next.js (frontend) + FastAPI (inference) + Supabase (backend) + Hierarchical Random Forest ML.

---

## 1. Project Overview

### Purpose
FAIV Predict is a full-stack Machine Learning system that predicts the **performance tier** (`HIGH` / `AVERAGE` / `LOW`) of an Instagram post **before** it is published, so creators and small brands can iterate on content with **data-driven recommendations** (with optional AI narrative enrichment via Gemini).

> ⚠️ The system is **not** a generative-AI tool. It does **not** rewrite captions and does **not** predict absolute reach numbers (no "+14% reach" claims). It outputs a **classification** (`predicted_class`) with a **confidence score** (0–100%) and recommends **parameter adjustments** (posting hour, hashtag count, CTA presence).

### Target Users
- **Creators / SMB social media specialists** — predict and optimize a post before publishing.
- **Brand admins** — manage brands, monitor model health, trigger retraining.
- **Researchers / reviewers** — inspect feature importance and model maturity.

### Goals
1. Communicate that this is a real, full-stack ML system — not a prototype.
2. Make hierarchical RF behavior (Niche fallback ↔ Personal model at `n=200`) visible and trustable.
3. Make recommendations explainable via **MDI feature importance**.
4. Resilient under FastAPI cold-starts and Gemini failures.

---

## 2. Design System

> Authoritative source: `DESIGN.md` & `src/styles.css`. This section is a digest.

### 2.1 Color (OKLCH tokens, never hardcode)

| Token | Role |
|---|---|
| `--background` / `--foreground` | Page surface & primary text |
| `--primary` (purple) | Brand actions, `HIGH` tier |
| `--accent` (lime) | Positive deltas, "Personal Model Active" |
| `--warning` (amber) | `AVERAGE` tier, cold-start, watch states |
| `--destructive` (red) | `LOW` tier softened, drift alerts, errors |
| `--muted` / `--muted-foreground` | Secondary surfaces & captions |
| `--border` | Hairlines (use sparingly) |

**Tier semantics are locked** — never recolor across surfaces:
`HIGH` = purple · `AVERAGE` = amber · `LOW` = muted-red.

### 2.2 Typography

Apple-system stack (`-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", Inter, system-ui`).
Numbers use `font-variant-numeric: tabular-nums`. One H1 per page.

### 2.3 Spacing & Layout

Base 4px. Page max-width `1280px`. App shell = 240px sidebar + topbar + main. Mobile-first; sidebar collapses to a Sheet.

### 2.4 Motion

180ms ease-out baseline. `active:scale-[0.97]` on interactive elements. Skeletons over spinners. Respect `prefers-reduced-motion`.

### 2.5 Component Library Standards (mandatory)

| Concern | Library |
|---|---|
| Icons | `lucide-react` (stroke 1.75) |
| Charts | `recharts` (always wrapped in `<ResponsiveContainer>`) |
| Animation | `framer-motion` |
| UI primitives | Radix via shadcn |

---

## 3. Information Architecture

### 3.1 Sitemap

| Route | Purpose |
|---|---|
| `/` | Landing / login |
| `/dashboard` | Overview + quick actions + model maturity strip |
| `/predict` | Input form (caption, format, schedule) |
| `/result` | Predicted tier + confidence + "Why this score" |
| `/diagnose` | MDI feature-importance bar chart |
| `/suggest` | TRE parameter recommendations + optional Gemini enrichment |
| `/calendar` | **Content Calendar** — monthly grid, batch prediction, Excel upload |
| `/admin` | Brand management + Model Health (rolling accuracy, drift, manual retrain) |

### 3.2 Primary User Flow

`Predict → Result → Diagnose → Suggest`
A persistent `<FlowStepper>` at the top of inference pages makes this linear flow explicit.

### 3.3 Calendar Flow (separate)

`Upload Excel → Grid Kalender Bulanan → Batch Prediction Progress → Export Diperkaya (.xlsx)`

---

## 4. Pages & UI Specifications

### 4.1 `/dashboard`
- Hero strip: account, niche, **Model Maturity (`n/200`)** pill.
- Quick actions: *New Prediction*, *Open Calendar*, *View Model Health*.
- Recent predictions table (tabular-nums, tier badges).

### 4.2 `/predict` — Input
- **Format dropdown — STRICT WHITELIST**: only `Reels`, `Carousel`, `Single Image`.
  > 🚫 **`Story` is forbidden in this dropdown.** The FastAPI inference endpoint does not support Story format and will return a 422. Story posts are handled exclusively by the *skip* logic in the Calendar module.
- Caption textarea + `<CaptionIntel>` panel (see 4.6).
- `<DateTimePicker>` for scheduled time (Radix popover, never raw `<input type="datetime-local">`).
- Primary CTA: *Predict*.

### 4.3 `/result` — Output
- Big tier badge (`HIGH` / `AVERAGE` / `LOW`) + `<ConfidenceMeter>` (0–100%).
- `<WhyThisScore>` panel (top-3 MDI contributors as a short list).
- Secondary CTAs: *Diagnose*, *Get recommendations*.
- Loading: `<ResultSkeleton>` matching final shape.

### 4.4 `/diagnose` — Explainability
- **Recharts horizontal bar chart** of **Mean Decrease in Impurity (MDI)** for the 6 model features.
- **Bar chart guardrails:**
  - Values are **positive percentages only**, summing to ~100%.
  - 🚫 **No negative-sentiment bars** (e.g. "Reduces score −8%"). MDI is a non-negative importance metric — it tells you *which* feature mattered, not *whether* it helped.
  - Sorted descending, primary purple fill, value labels in tabular-nums on the right edge.
- Short prose: "Caption length contributed most to this prediction" — no causal language.

### 4.5 `/suggest` — Hybrid Recommendations
- **Primary layer (always shown): Template Recommendation Engine (TRE)** — pure historical-data heuristics, no AI.
  - Parameter recommendations only — examples: *"Post between 19:00–21:00"*, *"Use 10–14 hashtags"*, *"Add a CTA"*.
  - Card structure: **Suggestion cards (TRE parameter recommendation: hour / hashtag / CTA) + AI Reasoning slot** (empty until enriched).
  - Each card has an *Apply* action that updates the draft post — it does **not** alter a numeric reach forecast.
- **Optional enrichment layer: Gemini** — triggered manually by a *"Perkaya dengan AI"* button.
  - Adds a short narrative *why* into each card's "AI Reasoning" slot.
  - Falls back silently to TRE-only on timeout (>8s) / error, with a small `"Standard recommendations"` info pill.

> 🚫 **Forbidden in this view:**
> - **No "projected lift +X%" numbers.** The Random Forest does not predict absolute reach. Do not animate any "+14% reach" deltas — the model has no such output.
> - **No "caption variants" / generated rewrites.** `/suggest` returns **parameter advice**, not regenerated captions.

### 4.6 `<CaptionIntel>` — Caption Intelligence (shared)
- **Strictly 3 indicators** (the only features the model consumes from text):
  1. `caption_length` — character count
  2. `hashtag_count` — `#` token count
  3. `has_cta` — boolean from CTA keyword detector
- 🚫 **No fictional metrics.** Do not add *hook strength*, *emoji density*, *readability score*, *sentiment*, etc. They are not features of the model and would mislead users.
- Local visual feedback updates **instantly**; the prediction refresh request is **debounced 500ms**.

### 4.7 `/calendar` — Content Calendar (killer feature)
- **Excel Upload** zone (drag/drop `.xlsx`, schema preview, validation errors inline).
- **Monthly Grid** — day cells show scheduled posts as colored chips (tier color once predicted).
- **Batch Prediction Progress** — top-of-page progress bar (`processed / total`), per-row status (queued → predicting → done / skipped / error).
- **Smart Auto-fill** — missing fields (e.g. hour) suggested from TRE before batch run.
- **Story skip logic** — rows with `format = Story` are flagged `Skipped (unsupported format)` with a muted chip; they are **not** sent to FastAPI.
- **Export Diperkaya** — download enriched `.xlsx` (original columns + `predicted_class`, `confidence_score`, `top_feature`, `tre_recommendation`).

### 4.8 `/admin` — Brand & Model Health
- **AI Brand Classifier modal** — admin enters business description + target audience; Gemini returns a niche suggestion (admin confirms/overrides).
- **Model Maturity table** per brand (`n/200`).
- **Model Health dashboard:**
  - Recharts line chart: rolling 7d / 30d accuracy.
  - Table: `Window`, `Samples`, `Accuracy`, `Δ vs baseline`, `Status` (Concept Drift Badge).
  - **Concept Drift Badge** — Stable (≤5pt) / Watch (5–15pt) / **Drift detected (>15pt, pulsing red)**.
  - **Trigger Retrain Manual** button — fires a GitHub Actions workflow.

---

## 5. Components Inventory

| Component | File | Role |
|---|---|---|
| AppShell | `src/components/AppShell.tsx` | Sidebar + topbar + responsive drawer |
| FlowStepper | `src/components/FlowStepper.tsx` | Predict → Result → Diagnose → Suggest |
| TierBadge | `src/components/TierBadge.tsx` | `HIGH` / `AVERAGE` / `LOW` |
| ConfidenceMeter | `src/components/ConfidenceMeter.tsx` | 0–100% confidence |
| ModelMaturity | `src/components/ModelMaturity.tsx` | `n/200` progress |
| CaptionIntel | `src/components/CaptionIntel.tsx` | 3-indicator panel + 500ms debounce |
| WhyThisScore | `src/components/WhyThisScore.tsx` | Top-3 MDI contributors |
| ResultSkeleton | `src/components/ResultSkeleton.tsx` | Loading shape for `/result` |
| PostingHeatmap | `src/components/PostingHeatmap.tsx` | Hour × weekday density |
| DateTimePicker | `src/components/DateTimePicker.tsx` | Radix popover scheduler |
| SectionHeader | `src/components/SectionHeader.tsx` | Page H1 + subtitle |

---

## 6. Wireframes (placeholders)

- `[Wireframe 1.0 — Dashboard overview]`
- `[Wireframe 2.1 — Predict input]`
- `[Wireframe 2.2 — Result + Why this score]`
- `[Wireframe 2.3 — Diagnose MDI bar chart]`
- `[Wireframe 2.4 — Suggest (TRE + AI Reasoning slot)]`
- `[Wireframe 3.0 — Content Calendar grid + batch progress]`
- `[Wireframe 3.5 — Admin Model Health (rolling accuracy + drift)]`

---

## 7. AI / ML Behavior (UX-relevant)

| Capability | Type | UX implication |
|---|---|---|
| Tier prediction | Hierarchical Random Forest | Returns `predicted_class` + `confidence_score`. Never an absolute reach number. |
| Personalization | Niche fallback → Personal model at `n=200` | Surface via `<ModelMaturity>` `n/200`. |
| Explainability | **MDI** (Mean Decrease in Impurity) | Horizontal bar chart, positive % only, ~100% total. |
| Recommendations | **TRE (data-driven)** + **Gemini (optional enrichment)** | Parameter cards always render from TRE; Gemini adds reasoning on demand. |
| Brand classification | Gemini one-shot | Admin-confirmed; not auto-applied. |
| Drift monitoring | Rolling accuracy vs baseline | Drift Badge + manual retrain CTA. |

### Forbidden UX patterns (model truthfulness)
- ❌ Animating a "+X% projected lift" number.
- ❌ Showing AI-generated caption variants.
- ❌ Showing negative MDI bars.
- ❌ Adding text-feature metrics beyond the 3 model inputs.
- ❌ Offering `Story` in the format dropdown.

---

## 8. Integrations (high level)

- **Next.js** frontend → REST calls to **FastAPI** inference service.
- **FastAPI** loads the trained Random Forest models from object storage and serves `/predict`, `/diagnose`, `/suggest`.
- **Supabase** — Postgres (predictions, brands, samples, accuracy snapshots), Auth, Storage (Excel uploads, model artifacts).
- **Gemini API** — invoked from a server function, only for AI Brand Classifier and `/suggest` enrichment. Always wrapped in TRE fallback.
- **GitHub Actions** — invoked by *Trigger Retrain Manual*.

Resiliency rules (see `DESIGN.md §10`): Global Error Boundary, per-surface *Service Unavailable* state with auto-retry (1s → 2s → 4s), Gemini → TRE silent fallback.

---

## 9. Future Improvements

- **Auto-retrain trigger** when drift > 15pt (today: manual only).
- **Multi-account brand workspace** with role-based access.
- **Cross-niche transfer learning** to shorten the cold-start window from `n=200` to `n=100`.
- **Calendar collaboration** — comments, approvals, publish-ready handoff.
- **Mobile-native shell** (PWA install + offline draft queue).
- **Public benchmarks page** for transparency on model accuracy per niche.

---

*Last updated: 2026-04-22*
