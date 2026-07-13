import { type Tier } from "@/lib/types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIERS = new Set<Tier>(["Low", "Average", "High"]);
const TIER_ORDINAL: Record<Tier, number> = { Low: 0, Average: 1, High: 2 };

export interface RealizedClassBasis {
  model_id: string;
  model_version: string | null;
  p33_threshold: number;
  p67_threshold: number;
  computed_at: string;
  minimum_post_age_days?: number;
  observation_policy?: string;
  maturity_policy?: string;
}

export type VerificationBadge = "match" | "one_off" | "miss";

export interface RealizedComparison {
  distance: 0 | 1 | 2;
  kind: VerificationBadge;
  label: "Match" | "One tier apart" | "Two tiers apart";
}

export function normalizeTier(value: unknown): Tier | null {
  if (typeof value !== "string") return null;
  const normalized = `${value.slice(0, 1).toUpperCase()}${value.slice(1).toLowerCase()}` as Tier;
  return TIERS.has(normalized) ? normalized : null;
}

export function sanitizeRealizedClassBasis(value: unknown): RealizedClassBasis | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const modelId = source.model_id;
  const p33 = source.p33_threshold;
  const p67 = source.p67_threshold;
  const computedAt = source.computed_at;
  if (
    typeof modelId !== "string" || !UUID_PATTERN.test(modelId) ||
    typeof p33 !== "number" || !Number.isFinite(p33) ||
    typeof p67 !== "number" || !Number.isFinite(p67) || p33 > p67 ||
    typeof computedAt !== "string" || !Number.isFinite(new Date(computedAt).getTime())
  ) return null;

  const minimumAge = source.minimum_post_age_days;
  const result: RealizedClassBasis = {
    model_id: modelId,
    model_version:
      typeof source.model_version === "string" ? source.model_version.slice(0, 80) : null,
    p33_threshold: p33,
    p67_threshold: p67,
    computed_at: computedAt,
  };
  if (typeof minimumAge === "number" && Number.isInteger(minimumAge) && minimumAge > 0 && minimumAge <= 365) {
    result.minimum_post_age_days = minimumAge;
  }
  if (typeof source.observation_policy === "string") {
    result.observation_policy = source.observation_policy.slice(0, 120);
  }
  if (typeof source.maturity_policy === "string") {
    result.maturity_policy = source.maturity_policy.slice(0, 120);
  }
  return result;
}

export function tierError(predicted: Tier | null, realized: Tier | null): 0 | 1 | 2 | null {
  if (!predicted || !realized) return null;
  return Math.abs(TIER_ORDINAL[predicted] - TIER_ORDINAL[realized]) as 0 | 1 | 2;
}

export function verificationBadge(error: 0 | 1 | 2 | null): VerificationBadge | null {
  if (error === 0) return "match";
  if (error === 1) return "one_off";
  if (error === 2) return "miss";
  return null;
}

export function compareRealizedTier(predicted: Tier, realized: Tier): RealizedComparison {
  const distance = tierError(predicted, realized) ?? 2;
  if (distance === 0) return { distance, kind: "match", label: "Match" };
  if (distance === 1) return { distance, kind: "one_off", label: "One tier apart" };
  return { distance, kind: "miss", label: "Two tiers apart" };
}

export function formatThreshold(value: number): string {
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 4 })}%`;
}

export function realizedOutcomeFields(input: {
  predicted: unknown;
  realized: unknown;
  basis: unknown;
  actualSource: unknown;
}) {
  const predicted = normalizeTier(input.predicted);
  const realized = input.actualSource === "instagram_media_id"
    ? normalizeTier(input.realized)
    : null;
  const basis = realized ? sanitizeRealizedClassBasis(input.basis) : null;
  const verifiedRealized = basis ? realized : null;
  const error = tierError(predicted, verifiedRealized);
  return {
    realized_tier: verifiedRealized,
    realized_class_basis: basis,
    tier_error: error,
    verification_badge: verificationBadge(error),
  };
}
