// Centralized dummy data for the FAIV Predict UI.
// Aligned with the actual ML system: hierarchical Random Forest (Niche → Personal),
// 6 input features, 3 output classes (HIGH / AVERAGE / LOW), confidence scores.
// All numbers, names, and timestamps are placeholders — UI only.

export type Tier = "High" | "Average" | "Low";
export type ContentFormat = "Reels" | "Carousel" | "Single Image";

// ---------------------------------------------------------------------------
// Dashboard KPIs (FR-06 / Wireframe 3.4)
// ---------------------------------------------------------------------------
export const KPIS = [
  {
    id: "predictions",
    label: "Total Predictions",
    value: "12,847",
    delta: "+18.4%",
    trend: "up" as const,
    sub: "vs last 30 days",
  },
  {
    id: "high-rate",
    label: "High-Tier Rate",
    value: "23.6%",
    delta: "+4.1%",
    trend: "up" as const,
    sub: "predicted as HIGH",
  },
  {
    id: "avg-confidence",
    label: "Avg. Confidence Score",
    value: "84.2%",
    delta: "+1.8%",
    trend: "up" as const,
    sub: "across active models",
  },
  {
    id: "rolling-accuracy",
    label: "30d Accuracy",
    value: "83.2%",
    delta: "-0.6%",
    trend: "down" as const,
    sub: "rolling validation",
  },
];

// ---------------------------------------------------------------------------
// Performance distribution — only 3 tiers from Random Forest output
// ---------------------------------------------------------------------------
export const PERFORMANCE_DISTRIBUTION = [
  { tier: "High" as Tier, count: 612, color: "var(--primary)" },
  { tier: "Average" as Tier, count: 1024, color: "var(--warning)" },
  { tier: "Low" as Tier, count: 318, color: "color-mix(in oklab, var(--foreground) 35%, transparent)" },
];

// ---------------------------------------------------------------------------
// Posting heatmap (7d × 24h)
// ---------------------------------------------------------------------------
export const HEATMAP_DATA: number[][] = (() => {
  const days = 7;
  const hours = 24;
  const grid: number[][] = [];
  for (let d = 0; d < days; d++) {
    const row: number[] = [];
    for (let h = 0; h < hours; h++) {
      const morning = Math.exp(-Math.pow((h - 9) / 2.2, 2)) * 0.6;
      const lunch = Math.exp(-Math.pow((h - 12.5) / 1.4, 2)) * 0.45;
      const evening = Math.exp(-Math.pow((h - 20) / 2.5, 2)) * 0.95;
      const weekendBoost = d >= 5 ? 0.15 : 0;
      const noise = (Math.sin(d * 7.3 + h * 1.9) + 1) * 0.08;
      const v = Math.min(1, morning + lunch + evening + weekendBoost + noise);
      row.push(Math.round(v * 100) / 100);
    }
    grid.push(row);
  }
  return grid;
})();

export const HEATMAP_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ---------------------------------------------------------------------------
// 30-day usage trend
// ---------------------------------------------------------------------------
export const USAGE_TREND = Array.from({ length: 30 }, (_, i) => {
  const seed = Math.sin(i * 1.7) * 0.5 + 0.5;
  return {
    day: i + 1,
    predictions: Math.round(280 + seed * 420 + (i % 5) * 30),
    high: Math.round(40 + seed * 90 + (i % 7) * 6),
  };
});

// ---------------------------------------------------------------------------
// Recent predictions (live feed)
// Only allowed formats: Reels / Carousel / Single Image
// Only allowed tiers: High / Average / Low
// ---------------------------------------------------------------------------
export const RECENT_PREDICTIONS: Array<{
  id: string;
  account: string;
  format: ContentFormat;
  tier: Tier;
  confidence: number;
  when: string;
}> = [
  { id: "pr_8821", account: "@nova.studio", format: "Reels", tier: "High", confidence: 94, when: "2 min ago" },
  { id: "pr_8820", account: "@kindred.brand", format: "Carousel", tier: "High", confidence: 88, when: "6 min ago" },
  { id: "pr_8819", account: "@orbit.media", format: "Single Image", tier: "Average", confidence: 71, when: "11 min ago" },
  { id: "pr_8818", account: "@solene.atelier", format: "Reels", tier: "Low", confidence: 64, when: "18 min ago" },
  { id: "pr_8817", account: "@halcyon.fm", format: "Carousel", tier: "Average", confidence: 82, when: "24 min ago" },
];

// ---------------------------------------------------------------------------
// Feature importance — MDI (Mean Decrease in Impurity)
// All values are POSITIVE proportions (0..1) summing to 1.0.
// Only the 6 real input features used by the Random Forest model.
// ---------------------------------------------------------------------------
export const FEATURE_IMPORTANCE: Array<{
  feature: string;
  key: "media_type" | "posting_hour" | "caption_length" | "hashtag_count" | "posting_day" | "has_cta";
  importance: number; // MDI proportion, sums to 1.0
}> = [
  { feature: "Media Type (format)", key: "media_type", importance: 0.28 },
  { feature: "Posting Hour", key: "posting_hour", importance: 0.22 },
  { feature: "Caption Length", key: "caption_length", importance: 0.17 },
  { feature: "Hashtag Count", key: "hashtag_count", importance: 0.14 },
  { feature: "Posting Day", key: "posting_day", importance: 0.11 },
  { feature: "Has CTA", key: "has_cta", importance: 0.08 },
];

// ---------------------------------------------------------------------------
// TRE (Template Recommendation Engine) suggestions — local, instant.
// Only references the 6 real features. No reach/impressions/saves projections,
// no apply-to-update mechanic. The model only outputs class + confidence.
// ---------------------------------------------------------------------------
export const SUGGESTIONS: Array<{
  id: string;
  feature: "caption_length" | "hashtag_count" | "has_cta" | "posting_hour" | "posting_day" | "media_type";
  title: string;
  detail: string;
  rationale: string;
}> = [
  {
    id: "s1",
    feature: "caption_length",
    title: "Trim caption to 180–320 characters",
    detail:
      "Posts in this niche with caption_length between 180–320 chars more often classify as HIGH.",
    rationale: "Niche baseline: HIGH-tier captions average 247 chars (P25–P75: 180–320).",
  },
  {
    id: "s2",
    feature: "has_cta",
    title: "Include an explicit CTA",
    detail:
      "Add a save / share / comment prompt so has_cta = 1 when the request is sent to the model.",
    rationale: "has_cta carries 8% MDI weight in the niche Random Forest stage.",
  },
  {
    id: "s3",
    feature: "hashtag_count",
    title: "Use 3–8 hashtags",
    detail:
      "Adjust hashtag_count to land between 3 and 8 — the modal range for HIGH-tier posts in this niche.",
    rationale: "hashtag_count carries 14% MDI weight in this niche's model.",
  },
  {
    id: "s4",
    feature: "posting_hour",
    title: "Reschedule into the 19:00–21:00 window",
    detail:
      "posting_hour is the second-strongest signal for this niche after media_type.",
    rationale: "Niche audience peak: 20:15 local. posting_hour MDI = 22%.",
  },
];

// ---------------------------------------------------------------------------
// Brands — with hierarchy stage (Niche fallback vs Personal model)
// Each brand has a `samples` count out of the 200-content threshold.
// ---------------------------------------------------------------------------
export type ModelStage = "Personal" | "Niche";
export type BrandStatus = "active" | "paused" | "trial";

export interface Brand {
  id: string;
  name: string;
  handle: string;
  niche: string;        // niche_id (Supabase column) — drives fallback model
  samples: number;       // content samples collected for this account
  stage: ModelStage;     // derived from samples >= 200
  accuracy: number;      // % accuracy on the active model for this brand
  drift: boolean;        // concept drift detected
  status: BrandStatus;
  lastRun: string;
}

const SAMPLE_TARGET = 200;
const stageOf = (s: number): ModelStage => (s >= SAMPLE_TARGET ? "Personal" : "Niche");

export const BRANDS: Brand[] = [
  { id: "d2850e10-2788-4833-be1b-cbbb782b68e9", name: "Lasence Bakeshop", handle: "@lasence.bakeshop", niche: "Bakery & Café", samples: 210, stage: stageOf(210), accuracy: 70.0, drift: false, status: "active", lastRun: "2h ago" },
  { id: "7c8316af-6692-481d-b6f7-2e5483afa5e1", name: "Bison Gym", handle: "@bison.gym", niche: "Fitness & Wellness", samples: 215, stage: stageOf(215), accuracy: 58.3, drift: false, status: "active", lastRun: "12m ago" },
];

// ---------------------------------------------------------------------------
// Niches available in the system (used by AI Brand Classifier)
// ---------------------------------------------------------------------------
export const NICHES = [
  "Bakery & Café",
  "Fitness & Wellness",
  "Creative Agency",
  "Lifestyle Retail",
  "Media & Publishing",
  "Fashion Atelier",
  "Food & Beverage",
  "Beauty & Skincare",
  "Hospitality",
  "Tech & SaaS",
];

// ---------------------------------------------------------------------------
// ML Models registry — naming follows hierarchy:
//   "Niche Model: <niche>"  or  "Personal Model: <brand>"
// Schema mirrors Supabase ml_models table → only is_active boolean.
// Includes 30-day rolling accuracy + drift detection.
// ---------------------------------------------------------------------------
export interface MlModel {
  id: string;
  name: string;          // "Niche Model: Bakery" / "Personal Model: Lasence"
  scope: "Niche" | "Personal";
  niche: string;
  version: string;
  baselineAccuracy: number; // accuracy at training time
  rollingAccuracy: number;  // 30d rolling validation accuracy
  is_active: boolean;
  trained: string;
  rolling30d: number[];     // 30 daily accuracy points (0..100)
}

const synthRolling = (target: number, drift: boolean) =>
  Array.from({ length: 30 }, (_, i) => {
    const noise = Math.sin(i * 1.3) * 1.4 + Math.cos(i * 0.7) * 0.8;
    if (drift && i >= 22) {
      // simulate concept drift in last week — drop > 15 pts
      return Math.max(40, target - 17 - (i - 22) * 0.6 + noise);
    }
    return Math.max(40, Math.min(99, target + noise));
  });

export const MODELS: MlModel[] = [
  {
    id: "m1",
    name: "Niche Model: Bakery & Café",
    scope: "Niche",
    niche: "Bakery & Café",
    version: "v4.2.1",
    baselineAccuracy: 84.0,
    rollingAccuracy: 83.6,
    is_active: true,
    trained: "2 days ago",
    rolling30d: synthRolling(83.6, false),
  },
  {
    id: "m2",
    name: "Niche Model: Fitness & Wellness",
    scope: "Niche",
    niche: "Fitness & Wellness",
    version: "v3.8.0",
    baselineAccuracy: 89.1,
    rollingAccuracy: 71.4,
    is_active: true,
    trained: "5 days ago",
    rolling30d: synthRolling(89.1, true),
  },
  {
    id: "m3",
    name: "Personal Model: Lasence Bakeshop",
    scope: "Personal",
    niche: "Bakery & Café",
    version: "v2.5.3",
    baselineAccuracy: 82.0,
    rollingAccuracy: 81.0,
    is_active: true,
    trained: "1 week ago",
    rolling30d: synthRolling(81.0, false),
  },
  {
    id: "m4",
    name: "Personal Model: Nova Studio",
    scope: "Personal",
    niche: "Creative Agency",
    version: "v1.4.0",
    baselineAccuracy: 87.2,
    rollingAccuracy: 86.4,
    is_active: true,
    trained: "12 hours ago",
    rolling30d: synthRolling(86.4, false),
  },
  {
    id: "m5",
    name: "Niche Model: Lifestyle Retail",
    scope: "Niche",
    niche: "Lifestyle Retail",
    version: "v3.1.0",
    baselineAccuracy: 79.0,
    rollingAccuracy: 78.5,
    is_active: false,
    trained: "3 months ago",
    rolling30d: synthRolling(78.5, false),
  },
];

// ---------------------------------------------------------------------------
// Tier metadata — only HIGH / AVERAGE / LOW
// HIGH = primary purple, AVERAGE = warning amber, LOW = muted destructive
// ---------------------------------------------------------------------------
export const TIER_META: Record<Tier, { label: string; color: string; bg: string; ring: string }> = {
  High: {
    label: "HIGH",
    color: "text-[oklch(0.45_0.20_295)] dark:text-[oklch(0.85_0.20_295)]",
    bg: "bg-[color-mix(in_oklab,var(--primary)_14%,transparent)]",
    ring: "ring-[color-mix(in_oklab,var(--primary)_35%,transparent)]",
  },
  Average: {
    label: "AVERAGE",
    color: "text-[oklch(0.50_0.16_75)] dark:text-[oklch(0.85_0.16_75)]",
    bg: "bg-[color-mix(in_oklab,var(--warning)_16%,transparent)]",
    ring: "ring-[color-mix(in_oklab,var(--warning)_38%,transparent)]",
  },
  Low: {
    label: "LOW",
    color: "text-[oklch(0.48_0.18_22)] dark:text-[oklch(0.78_0.20_22)]",
    bg: "bg-[color-mix(in_oklab,var(--destructive)_12%,transparent)]",
    ring: "ring-[color-mix(in_oklab,var(--destructive)_30%,transparent)]",
  },
};
