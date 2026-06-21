# FAIV Predict — Design System

> A clean, Notion-inspired SaaS aesthetic with Apple-system typography, a confident purple primary, and a lime-green accent. Light-mode first, dark-mode supported. Mobile-first, fully responsive.

---

## 1. Design Principles

1. **Clarity over decoration.** Reduce borders, soften shadows, lean on whitespace and typography to create hierarchy.
2. **Mixed density.** Avoid endless card grids — alternate borderless sections, highlight panels, and dense data zones for rhythm.
3. **Effortless motion.** 180ms ease-out is the baseline. Motion confirms intent; it never delays it.
4. **Optimistic feedback.** Actions reflect instantly. Numbers animate, badges crossfade, layouts reflow smoothly.
5. **Premium calm.** Subtle gradients, minimal glow, no decorative chrome. The product should feel lightweight and fast.
6. **Fail gracefully.** No service failure should ever produce a blank page. Every async surface has a defined fallback state.

---

## 2. Color System

All colors are defined as OKLCH tokens in `src/styles.css`. **Never hardcode color values in components.**

### Core palette

| Token | Light | Role |
|---|---|---|
| `--background` | `oklch(0.995 0.002 280)` | Page background — near-white with cool tint |
| `--foreground` | `oklch(0.18 0.02 270)` | Primary text |
| `--primary` | Purple `oklch(~0.55 0.22 290)` | Brand actions, links, focus |
| `--primary-foreground` | White | Text on primary |
| `--accent` | Lime `oklch(~0.88 0.20 130)` | Highlights, positive deltas, callouts |
| `--warning` | Amber `oklch(~0.78 0.16 75)` | "Average" tier, cold-start, soft alerts |
| `--muted` | `oklch(0.96 0.005 270)` | Secondary surfaces |
| `--muted-foreground` | `oklch(0.45 0.02 270)` | Captions, labels |
| `--border` | `oklch(0.92 0.005 270)` | Hairlines (use sparingly) |
| `--destructive` | Red | Errors, deletions, drift alerts |

### Semantic aliases

- `--gradient-primary` — purple → lighter purple, used for hero bands
- `--shadow-elevated` — soft 2-layer shadow for floating panels
- `--shadow-soft` — barely-there ambient lift for cards

### Usage rules

- Purple = action / brand. Lime = signal / positive change. Amber = caution / cold-start. Red = failure / drift. Never swap them.
- Use `color-mix(in oklab, var(--primary) X%, transparent)` for translucent fills.
- Borders are optional. Prefer background separation or whitespace.

---

## 3. Typography

Apple-system stack for a familiar, refined SaaS feel.

```css
font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display",
             "Inter", system-ui, sans-serif;
font-feature-settings: "ss01", "cv11";
text-rendering: optimizeLegibility;
-webkit-font-smoothing: antialiased;
```

### Scale & tracking

| Role | Size | Weight | Tracking |
|---|---|---|---|
| Display | 40–56px | 600 | `-0.024em` |
| H1 | 28–32px | 600 | `-0.02em` |
| H2 | 22–24px | 600 | `-0.015em` |
| H3 | 18px | 600 | `-0.01em` |
| Body | 14–15px | 400 | `-0.005em` |
| Label | 12–13px | 500 | `0` (uppercase optional, use 0.04em then) |
| Data / numeric | tabular-nums, slightly heavier | 500 | `-0.005em` |

### Hierarchy rules

- **One H1 per page.** Use `<SectionHeader>` for consistent spacing.
- Numbers use `font-variant-numeric: tabular-nums` so they don't shift when animating.
- Don't mix more than 2 weights in a single block.

---

## 4. Spacing & Layout

Base unit: **4px**. Use Tailwind's spacing scale (`gap-2`, `p-6`, etc.).

| Token | Use |
|---|---|
| `4 / 8` | Inline gaps, chip padding |
| `12 / 16` | Component internal padding |
| `24 / 32` | Section padding, card padding |
| `48 / 64` | Page-level vertical rhythm |

### Layout patterns

- **App shell**: 240px sidebar + topbar + main. Sidebar collapses on mobile into a drawer.
- **Page max-width**: `max-w-[1280px]`, centered, with `px-5 md:px-10`.
- **Mixed density**: Alternate full-bleed hero → 2-column grid → borderless data row → highlight panel.
- **Avoid**: 4 identical cards in a row. Break it up with a wider feature panel or borderless metric strip.

---

## 5. Responsive UI (NF-09)

The dashboard **must** function fully on both desktop and mobile. Design mobile-first, then enhance with `md:` and `lg:` modifiers.

### Breakpoints (Tailwind defaults)

| Token | Min width | Use |
|---|---|---|
| (base) | 0px | Mobile portrait — single-column stacks, drawer nav, full-width inputs |
| `sm:` | 640px | Mobile landscape — 2-column metric strips |
| `md:` | 768px | Tablet — sidebar peeks in, 2-column page grid |
| `lg:` | 1024px | Desktop — full sidebar + topbar, 3-column data zones |
| `xl:` | 1280px | Wide desktop — page max-width caps; no further density growth |

### Rules

- **Mobile-first**: Write base classes for mobile, add `md:` / `lg:` only to upgrade.
  ```tsx
  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
  ```
- **Touch targets**: Minimum 44×44px on mobile (`min-h-11 min-w-11`).
- **Sidebar**: Collapses to a Sheet/drawer below `md`. Topbar shows a hamburger trigger.
- **Tables**: Horizontally scroll on mobile (`overflow-x-auto`); never crush columns.
- **Charts**: Recharts `<ResponsiveContainer>` always. Reduce label density on mobile (`hide` axis ticks below `sm`).
- **Typography**: Scale display sizes down by ~25% on mobile (e.g. `text-3xl md:text-5xl`).

---

## 6. Motion

| Property | Value |
|---|---|
| Default duration | **180ms** |
| Easing | **ease-out** (`cubic-bezier(0.22, 1, 0.36, 1)`) |
| Hover | 120ms ease-out |
| Page enter | 240ms ease-out, 8px y-offset |
| Number tween | `requestAnimationFrame`, 400–600ms |

### Patterns

- **Pressed state**: `active:scale-[0.97]` on all interactive elements.
- **Hover lift**: shadow + 1px translateY, never scale.
- **Layout shift**: use `framer-motion`'s `layout` prop, not manual transitions.
- **Skeleton states** > spinners. Match the shape of the content that's loading.

---

## 7. Interaction Rules

### Caption Intelligence — debounce (500ms)

The Caption Intelligence panel (character counter, hashtag count, CTA detector, prediction refresh) **must** debounce input by **500ms** before firing any prediction-update request. This keeps the typing experience smooth and prevents the FastAPI inference endpoint from being hammered on every keystroke.

```ts
// pattern
const debouncedCaption = useDebouncedValue(caption, 500);
useEffect(() => { refetchPrediction(debouncedCaption); }, [debouncedCaption]);
```

Local visual feedback (color transitions, char counter) updates **instantly** on every keystroke — only the network request is debounced.

### Optimistic UI

- Applying a suggestion updates projected lift **immediately** with an animated number tween. Reconcile with the server response when it arrives; if it disagrees, ease back to the true value (don't jump).
- Tier badges crossfade between states; never blink.

---

## 8. Components

### Buttons
- Primary: filled purple, soft shadow, white text.
- Secondary: muted background, foreground text.
- Ghost: transparent until hover (muted bg).
- Always: rounded-lg (10px), `active:scale-[0.97]`, 180ms transitions.

### Cards & Panels
- Default card: `bg-card`, `rounded-2xl`, `shadow-soft`, **no border**.
- Highlight panel: gradient background, lime accent stroke, used for hero metrics.
- Borderless section: just whitespace + heading — for secondary data.

### Inputs
- 40px height (44px on mobile), `rounded-lg`, muted border, focus ring uses primary at 30%.
- Datetime picker: Radix popover with calendar + tactile time spinner. Never use a raw `<input type="datetime-local">`.

### Badges (Tier)
Tier semantics are shared across badges, charts, and visualizations — never re-color them per surface.

- `Viral` — lime fill, dark text — `var(--accent)`
- `Strong` — purple fill, white text — `var(--primary)`
- `Average` — amber fill, dark text — `var(--warning)`  ← dedicated warning color
- `Weak` — destructive at 15%, destructive text — `var(--destructive)`

### Model Maturity
- Compact pill or full segmented progress bar showing `n/200` samples.
- Three states with fixed colors: **Low Confidence** (warning amber), **Learning** (primary purple), **Personal Model Active** (accent lime).

### Data viz
- **Library**: Recharts only. All dashboard charts, feature-importance plots, and trend lines use Recharts.
- **Feature importance (MDI)**: Horizontal bar chart (`<BarChart layout="vertical">`), bars sorted descending, primary purple fill, value labels on the right edge in tabular-nums.
- Palette: primary purple, accent lime, warning amber for "Average", muted gray for baselines.
- Grid lines: `var(--border)` at 50% opacity.
- Tooltips: `bg-popover`, `shadow-elevated`, no border.
- Always wrap in `<ResponsiveContainer>` for NF-09 compliance.

---

## 9. Component Library Standards

These libraries are **mandatory** — do not introduce alternatives without an architectural review.

| Concern | Library | Notes |
|---|---|---|
| Icons | **`lucide-react`** | Stroke 1.75. Sizes: 16px inline, 20px buttons, 24px section headers. No emoji as iconography. |
| Charts & data viz | **`recharts`** | Used for the MDI horizontal bar chart, dashboard trend/area charts, distributions, and admin rolling-accuracy plots. |
| Animation | `framer-motion` | 180ms ease-out baseline. |
| UI primitives | Radix UI via shadcn | Wrap them in project components, don't fork. |

---

## 10. Graceful Degradation & Error States

The product talks to two external services that **can fail or sleep**: the FastAPI inference API (Railway free tier sleeps after inactivity) and the LLM suggestions API (rate limits / timeouts). The UI must never crash or render blank — every async surface has a defined fallback.

### Suggest — LLM fallback to TRE

When the LLM call errors, times out (>8s), or returns an unusable response, the **Suggest** view must automatically fall back to the **Template Recommendation Engine (TRE)** and render "Standard Recommendations" without flashing a blank state.

Required UX:
- Render TRE recommendations in the **same card layout** as LLM suggestions — same typography, same apply button, same lift preview.
- Show a small inline pill above the list: `"Standard recommendations"` in `--muted-foreground`, with an `Info` icon and tooltip explaining that AI suggestions are temporarily unavailable.
- The "Apply" / optimistic-lift interaction must work identically — TRE-applied suggestions still animate the projected lift number.
- Never block the page or show a destructive error. The fallback is the success state.

### TC-20 — FastAPI down / Service Unavailable

If the FastAPI backend is unreachable (cold-start sleeping, 5xx, network error), the Next.js app must surface a clear, non-crashing state:

- **Global Error Boundary** wraps the route tree (`__root.tsx` `errorComponent` + per-route `errorComponent`). It renders a "Something went wrong" panel with a `Retry` button that calls `router.invalidate()`.
- **Per-surface Service Unavailable state** for prediction-dependent panels:
  - Visual: muted card, `AlertCircle` icon (`--warning`), heading "Prediction service warming up", body copy "Our model is starting back up — this usually takes 10–20 seconds."
  - Actions: a primary `Retry` button (re-fires the request) and a secondary `Continue editing` link (lets the user keep typing the caption locally).
  - Auto-retry with exponential backoff (1s → 2s → 4s, max 3 attempts) before showing the manual retry.
- **Never** render `undefined`/`NaN` into a metric. If data is missing, show `—` in muted-foreground.

---

## 11. Admin — Model Health

The administrator view (Wireframe 3.5) needs its own component vocabulary inside the existing design system.

### Concept Drift Badge

A status pill showing the current model's accuracy delta vs. its baseline.

- **Stable** — accuracy drop ≤ 5pts — `--accent` (lime), `CheckCircle2` icon.
- **Watch** — accuracy drop 5–15pts — `--warning` (amber), `AlertTriangle` icon.
- **Drift detected** — accuracy drop > 15pts — `--destructive` (red), pulsing glow (`shadow: 0 0 0 0 var(--destructive)` → `0 0 0 8px transparent` 1.6s ease-out infinite), `AlertOctagon` icon. This is the only place a pulsing glow is allowed in the product — it must be unmistakable.

```tsx
<DriftBadge severity="drift" deltaPts={-18} />
```

### Rolling Accuracy Table

- Recharts `LineChart` (rolling 7-day / 30-day accuracy) above a dense table.
- Table columns: `Window`, `Samples`, `Accuracy`, `Δ vs baseline`, `Status` (uses Concept Drift Badge).
- Use `tabular-nums`. Sort affordances on every numeric column.
- Row hover: `bg-muted/50`. Drift rows: subtle red tint `bg-[color-mix(in_oklab,var(--destructive)_6%,transparent)]`.
- Mobile: collapse to a card list (`Window` + key metrics stacked) — same data, different layout.

---

## 12. Iconography

- **Library**: `lucide-react` only.
- **Stroke**: 1.75 (slightly lighter than default 2).
- **Size**: 16px inline, 20px buttons, 24px section headers.

---

## 13. Accessibility

- Minimum contrast: WCAG AA (4.5:1 for body, 3:1 for large text).
- Focus rings always visible — `ring-2 ring-primary/40 ring-offset-2`.
- Hit targets ≥ 36×36px on desktop, ≥ 44×44px on mobile.
- Motion-reduced users: respect `prefers-reduced-motion` (skip number tweens, instant layout shifts, disable drift-badge pulse).

---

## 14. Do / Don't

| ✅ Do | ❌ Don't |
|---|---|
| Use semantic tokens (`bg-primary`, `text-foreground`) | Hardcode `#7c3aed` or `bg-purple-600` |
| Animate numbers and tier shifts on apply | Show a spinner and wait |
| Mix layout densities for rhythm | Stack 6 identical cards in a column |
| Use whitespace for separation | Add a border to every section |
| Keep motion under 300ms | Use 500ms+ "fancy" easings |
| One bold accent per view | Rainbow every metric chip |
| Debounce caption input by 500ms before re-predicting | Fire a request on every keystroke |
| Fall back to TRE when LLM fails | Show a blank suggestions panel |
| Use `lucide-react` + `recharts` | Mix in Heroicons / Chart.js |

---

## 15. File References

- **Tokens & globals**: `src/styles.css`
- **Layout shell**: `src/components/AppShell.tsx`
- **Section header**: `src/components/SectionHeader.tsx`
- **Datetime picker**: `src/components/DateTimePicker.tsx`
- **Tier badge**: `src/components/TierBadge.tsx`
- **Confidence meter**: `src/components/ConfidenceMeter.tsx`
- **Heatmap**: `src/components/PostingHeatmap.tsx`
- **Caption Intelligence**: `src/components/CaptionIntel.tsx`
- **Model Maturity (n/200)**: `src/components/ModelMaturity.tsx`
- **Why this score**: `src/components/WhyThisScore.tsx`
- **Flow stepper**: `src/components/FlowStepper.tsx`
