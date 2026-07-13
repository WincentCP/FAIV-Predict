import { describe, expect, it } from "vitest";
import { formatModelScore } from "../lib/model-scores";
import { sanitizeBrandPatterns } from "../lib/brand-patterns";
import {
  compareRealizedTier,
  sanitizeRealizedClassBasis,
  tierError,
} from "../lib/realized-outcomes";
import {
  isTrendNoteStale,
  normalizeTrendNotes,
} from "../lib/trend-notes";

describe("realized tier comparison", () => {
  it.each([
    ["Low", "Low", 0, "match"],
    ["Low", "Average", 1, "one_off"],
    ["Low", "High", 2, "miss"],
    ["High", "Average", 1, "one_off"],
  ] as const)("compares %s to %s", (predicted, realized, distance, kind) => {
    expect(tierError(predicted, realized)).toBe(distance);
    expect(compareRealizedTier(predicted, realized).kind).toBe(kind);
  });

  it("accepts only a complete ordered threshold basis", () => {
    const valid = sanitizeRealizedClassBasis({
      model_id: "123e4567-e89b-42d3-a456-426614174000",
      model_version: "v1",
      p33_threshold: 1.2,
      p67_threshold: 3.4,
      computed_at: "2026-07-13T00:00:00Z",
    });
    expect(valid?.p67_threshold).toBe(3.4);
    expect(sanitizeRealizedClassBasis({ ...valid, p33_threshold: 5 })).toBeNull();
  });
});

describe("trend-note freshness", () => {
  const now = new Date("2026-07-15T12:00:00Z");

  it("treats 14 days as current and 15 days as stale", () => {
    expect(isTrendNoteStale("2026-07-01", now)).toBe(false);
    expect(isTrendNoteStale("2026-06-30", now)).toBe(true);
  });

  it("normalizes, sorts, and rejects malformed notes", () => {
    const notes = normalizeTrendNotes({ notes: [
      { id: "2", brand_id: "b", note: " Newer ", source: "Report", observed_at: "2026-07-02", created_at: "2026-07-02", is_stale: false, tag: null },
      { id: "1", brand_id: "b", note: "Older", source: "Review", observed_at: "2026-07-01", created_at: "2026-07-01", is_stale: false, tag: "format" },
      { id: "bad", brand_id: "b", note: "", source: "", observed_at: "not-a-date" },
    ] });
    expect(notes.map((note) => note.id)).toEqual(["2", "1"]);
    expect(notes[0].note).toBe("Newer");
  });
});

describe("model score language", () => {
  it("always labels numeric scores as relative and uncalibrated", () => {
    expect(formatModelScore(78.4)).toBe("78/100 relative model score (uncalibrated)");
    expect(formatModelScore(null)).toBe("Model score unavailable");
  });
});

describe("brand momentum sanitization", () => {
  it("keeps only bounded descriptive momentum and its ER caveat", () => {
    const result = sanitizeBrandPatterns({
      status: "success",
      brand: { id: "brand-1", name: "Brand", niche: "Food" },
      evidence: {},
      patterns: {},
      highlights: [],
      freshness: { status: "current" },
      brand_history_momentum: {
        window_days: 90,
        recent_window: { start_at: "2026-04-01T00:00:00Z", end_at: "2026-07-01T00:00:00Z", posts: 8, format_mix: [] },
        prior_window: { start_at: "2026-01-01T00:00:00Z", end_at: "2026-04-01T00:00:00Z", posts: 5, format_mix: [] },
        format_mix_changes: [{ key: "reels", label: "Reels", recent_sample_size: 6, prior_sample_size: 2, recent_share: 0.75, prior_share: 0.4, share_change_pp: 35, evidence_level: "limited" }],
        preferred_mix_statements: ["Reels share rose from 40% to 75%.", "Second line.", "This third line must be removed."],
        er_context: { decision_use_allowed: false, interpretation: "descriptive_only_age_confounded", caveat: "Cumulative ER is age-confounded.", formats: [], dayparts: [] },
        raw_captions: ["must not escape"],
      },
      not_measured: [],
      limitations: [],
    }, { id: "brand-1", name: "Brand", niche: "Food" });
    expect(result?.brand_history_momentum?.preferred_mix_statements).toHaveLength(2);
    expect(result?.brand_history_momentum?.er_context.caveat).toContain("age-confounded");
    expect(result?.brand_history_momentum).not.toHaveProperty("raw_captions");
  });
});
