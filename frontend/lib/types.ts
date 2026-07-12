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

// Tier metadata. A tier is a model class, not a calibrated probability.
export const TIER_META: Record<Tier, { label: string; color: string; bg: string; ring: string }> = {
  High: {
    label: "HIGH",
    color: "text-primary",
    bg: "bg-primary/10",
    ring: "ring-primary/25",
  },
  Average: {
    label: "AVERAGE",
    color: "text-amber-700 dark:text-amber-300",
    bg: "bg-warning/10",
    ring: "ring-warning/30",
  },
  Low: {
    label: "LOW",
    color: "text-destructive",
    bg: "bg-destructive/10",
    ring: "ring-destructive/25",
  },
};
