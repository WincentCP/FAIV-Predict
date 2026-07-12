// Shared domain types for the FAIV Predict UI.
// These mirror the real ML system contract: hierarchical Random Forest
// (Niche → Personal), 3 output classes (HIGH / AVERAGE / LOW).

export type Tier = "High" | "Average" | "Low";
export type ContentFormat = "Reels" | "Carousel" | "Single Image";

/** Number of historical posts required before a brand graduates to a personal model. */
export const SAMPLE_TARGET = 200;

export interface Brand {
  id: string;
  name: string;
  niche: string;
  followers: number | null;
  model_type: "niche" | "personal";
  /** Latest verified artifact actually available for this workspace. */
  active_model_scope: "personal" | "cohort" | "none";
  /** Real count of historical posts stored for this brand. */
  samples: number;
  /** Optional operator-maintained brand identity summary for planning context. */
  profile_summary?: string | null;
  /** IANA planning timezone. Current training features use WIB buckets. */
  timezone?: string;
  created_at?: string;
}

export interface MlModel {
  id: string;
  name: string; // Human-readable model scope and brand/industry label.
  scope: "Niche" | "Personal";
  niche: string;
  version: string;
  baselineAccuracy: number | null; // validation accuracy recorded at training time
  trained: string;
  brandId?: string;
  evaluationStatus?: "validated" | "exploratory" | null;
  macroF1?: number | null;
  balancedAccuracy?: number | null;
  majorityBaselineAccuracy?: number | null;
  accuracyGain?: number | null;
  holdoutSamples?: number | null;
}

/** Normalize user-entered brand references for matching, never for display. */
export function normalizeBrandReference(value: string): string {
  return value.trim().toLowerCase().replace(/^@/, "").replace(/[\s_-]+/g, "");
}

// Tier metadata — HIGH = primary purple, AVERAGE = warning amber, LOW = muted destructive
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
