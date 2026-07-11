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
  /** Real count of historical posts stored for this brand. */
  samples: number;
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
}

/** Derive the display handle for a brand (the brands table stores no handle). */
export function brandHandle(name: string): string {
  return `@${name.toLowerCase().replace(/\s+/g, "")}`;
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
