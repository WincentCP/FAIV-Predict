export type BrandPatternEvidenceLevel = "limited" | "exploratory" | "directional";

export interface BrandPatternGroup {
  key: string;
  label: string;
  sample_size: number;
  median_er: number;
  q1_er: number;
  q3_er: number;
  difference_from_brand_median_pp: number;
  high_tier_share: number;
  evidence_level: BrandPatternEvidenceLevel;
  eligible_for_highlight: boolean;
}

export interface BrandPatternHighlight extends BrandPatternGroup {
  dimension: string;
}

export interface BrandPatternsPayload {
  status: "success" | "empty";
  brand: { id: string; name: string; niche: string };
  evidence: {
    mature_verified_posts: number;
    eligible_posts: number;
    excluded_unmodeled_posts: number;
    excluded_format_counts: Record<string, number>;
    first_post_at: string | null;
    last_post_at: string | null;
    latest_sync_at: string | null;
    minimum_group_samples: number;
    minimum_highlight_total: number;
    maturity_days: number;
    outcome: string | null;
    source: string | null;
  };
  overall: {
    median_er: number;
    q1_er: number;
    q3_er: number;
    p33_er: number;
    p67_er: number;
  } | null;
  patterns: Record<string, BrandPatternGroup[]>;
  highlights: BrandPatternHighlight[];
  freshness: {
    status: "current" | "aging" | "stale" | "empty";
    days_since_latest_mature_post: number | null;
    weekly_sync_and_retraining: boolean;
    historical_samples_equally_weighted: boolean;
    external_trends_included: boolean;
    seasonal_features_included: boolean;
    note: string | null;
  };
  recent_publishing_mix: {
    window_days: number;
    posts: number;
    eligible_modeled_posts: number;
    excluded_unmodeled_posts: number;
    format_counts: Record<string, number>;
    daypart_counts: Record<string, number>;
    performance_comparison_available: boolean;
    reason: string;
  } | null;
  not_measured: Array<{ key: string; label: string; reason: string }>;
  limitations: string[];
}

const PATTERN_DIMENSIONS = new Set([
  "formats",
  "dayparts",
  "day_type",
  "cta",
  "question",
  "emoji",
  "caption_length",
  "hashtags",
]);
const EVIDENCE_LEVELS = new Set<BrandPatternEvidenceLevel>([
  "limited",
  "exploratory",
  "directional",
]);
const FRESHNESS_STATES = new Set(["current", "aging", "stale", "empty"]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, max = 240): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : null;
}

function number(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nonNegativeInteger(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : fallback;
}

function isoDate(value: unknown): string | null {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
}

function countMap(value: unknown): Record<string, number> {
  const source = record(value);
  if (!source) return {};
  return Object.fromEntries(
    Object.entries(source)
      .filter(([key, count]) => key.length <= 100 && nonNegativeInteger(count, -1) >= 0)
      .slice(0, 20)
      .map(([key, count]) => [key, nonNegativeInteger(count)])
  );
}

function patternGroup(value: unknown): BrandPatternGroup | null {
  const source = record(value);
  if (!source) return null;
  const key = text(source.key, 80);
  const label = text(source.label, 140);
  const evidenceLevel = text(source.evidence_level, 20) as BrandPatternEvidenceLevel | null;
  if (!key || !label || !evidenceLevel || !EVIDENCE_LEVELS.has(evidenceLevel)) return null;
  return {
    key,
    label,
    sample_size: nonNegativeInteger(source.sample_size),
    median_er: number(source.median_er),
    q1_er: number(source.q1_er),
    q3_er: number(source.q3_er),
    difference_from_brand_median_pp: number(source.difference_from_brand_median_pp),
    high_tier_share: Math.max(0, Math.min(1, number(source.high_tier_share))),
    evidence_level: evidenceLevel,
    eligible_for_highlight: source.eligible_for_highlight === true,
  };
}

/**
 * Whitelists the internal service response before it reaches a browser or LLM
 * prompt. Raw captions and media identifiers are deliberately not represented
 * by this contract.
 */
export function sanitizeBrandPatterns(
  value: unknown,
  expectedBrand: { id: string; name: string; niche: string }
): BrandPatternsPayload | null {
  const source = record(value);
  if (!source || (source.status !== "success" && source.status !== "empty")) return null;
  const brand = record(source.brand);
  if (!brand || brand.id !== expectedBrand.id) return null;
  const evidence = record(source.evidence) || {};
  const overallSource = record(source.overall);
  const freshnessSource = record(source.freshness) || {};
  const rawPatterns = record(source.patterns) || {};
  const patterns: Record<string, BrandPatternGroup[]> = {};
  for (const [dimension, groups] of Object.entries(rawPatterns)) {
    if (!PATTERN_DIMENSIONS.has(dimension) || !Array.isArray(groups)) continue;
    patterns[dimension] = groups.map(patternGroup).filter((group): group is BrandPatternGroup => group !== null);
  }

  const highlights = Array.isArray(source.highlights)
    ? source.highlights.flatMap((value) => {
        const item = record(value);
        const dimension = text(item?.dimension, 60);
        const group = patternGroup(value);
        return dimension && group ? [{ dimension, ...group }] : [];
      }).slice(0, 12)
    : [];
  const recent = record(source.recent_publishing_mix);
  const freshnessStatus = text(freshnessSource.status, 20);

  return {
    status: source.status,
    brand: {
      id: expectedBrand.id,
      name: text(brand.name, 160) || expectedBrand.name,
      niche: text(brand.niche, 120) || expectedBrand.niche,
    },
    evidence: {
      mature_verified_posts: nonNegativeInteger(
        evidence.mature_verified_posts,
        nonNegativeInteger(evidence.eligible_posts)
      ),
      eligible_posts: nonNegativeInteger(evidence.eligible_posts),
      excluded_unmodeled_posts: nonNegativeInteger(evidence.excluded_unmodeled_posts),
      excluded_format_counts: countMap(evidence.excluded_format_counts),
      first_post_at: isoDate(evidence.first_post_at),
      last_post_at: isoDate(evidence.last_post_at),
      latest_sync_at: isoDate(evidence.latest_sync_at),
      minimum_group_samples: nonNegativeInteger(evidence.minimum_group_samples, 5),
      minimum_highlight_total: nonNegativeInteger(evidence.minimum_highlight_total, 20),
      maturity_days: nonNegativeInteger(evidence.maturity_days, 7),
      outcome: text(evidence.outcome, 200),
      source: text(evidence.source, 100),
    },
    overall: overallSource
      ? {
          median_er: number(overallSource.median_er),
          q1_er: number(overallSource.q1_er),
          q3_er: number(overallSource.q3_er),
          p33_er: number(overallSource.p33_er),
          p67_er: number(overallSource.p67_er),
        }
      : null,
    patterns,
    highlights,
    freshness: {
      status: FRESHNESS_STATES.has(freshnessStatus || "")
        ? (freshnessStatus as BrandPatternsPayload["freshness"]["status"])
        : "empty",
      days_since_latest_mature_post:
        typeof freshnessSource.days_since_latest_mature_post === "number"
          ? nonNegativeInteger(freshnessSource.days_since_latest_mature_post)
          : null,
      weekly_sync_and_retraining: freshnessSource.weekly_sync_and_retraining === true,
      historical_samples_equally_weighted: freshnessSource.historical_samples_equally_weighted === true,
      external_trends_included: freshnessSource.external_trends_included === true,
      seasonal_features_included: freshnessSource.seasonal_features_included === true,
      note: text(freshnessSource.note, 400),
    },
    recent_publishing_mix: recent
      ? {
          window_days: nonNegativeInteger(recent.window_days, 90),
          posts: nonNegativeInteger(recent.posts),
          eligible_modeled_posts: nonNegativeInteger(
            recent.eligible_modeled_posts,
            nonNegativeInteger(recent.posts)
          ),
          excluded_unmodeled_posts: nonNegativeInteger(recent.excluded_unmodeled_posts),
          format_counts: countMap(recent.format_counts),
          daypart_counts: countMap(recent.daypart_counts),
          performance_comparison_available: recent.performance_comparison_available === true,
          reason: text(recent.reason, 400) || "A comparable performance window is not available.",
        }
      : null,
    not_measured: Array.isArray(source.not_measured)
      ? source.not_measured.flatMap((value) => {
          const item = record(value);
          const key = text(item?.key, 80);
          const label = text(item?.label, 120);
          const reason = text(item?.reason, 400);
          return key && label && reason ? [{ key, label, reason }] : [];
        }).slice(0, 12)
      : [],
    limitations: Array.isArray(source.limitations)
      ? source.limitations.flatMap((item) => {
          const safe = text(item, 400);
          return safe ? [safe] : [];
        }).slice(0, 12)
      : [],
  };
}
