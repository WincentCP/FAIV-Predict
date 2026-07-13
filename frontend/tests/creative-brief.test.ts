import { describe, expect, it } from "vitest";
import {
  CREATIVE_BRIEF_HEADER,
  emptyCreativeBrief,
  parseCreativeBrief,
  serializeCreativeBrief,
  validateCreativeBrief,
} from "../lib/creative-brief";

describe("Creative Brief persistence", () => {
  it("keeps an empty brief out of persisted content", () => {
    expect(serializeCreativeBrief(emptyCreativeBrief())).toBe("");
  });

  it("round-trips every supported field in the versioned format", () => {
    const brief = {
      objective: "education" as const,
      contentPillar: "Product education",
      hook: "Why does this happen: a quick explanation?",
      storytellingStyle: "demo_tutorial" as const,
      visualDirection: "Open on the product.\nThen show the three steps.",
      cta: "save" as const,
      durationSeconds: 35,
      slideCount: null,
      trendContext: "Short tutorials are appearing more often.",
      trendSource: "Editorial review, July 2026",
      trendObservedAt: "2026-07-01",
    };
    const serialized = serializeCreativeBrief(brief);
    expect(serialized.startsWith(CREATIVE_BRIEF_HEADER)).toBe(true);
    expect(parseCreativeBrief(serialized)).toEqual({
      ...brief,
      visualDirection: "Open on the product. Then show the three steps.",
    });
  });

  it("preserves legacy free text as visual direction", () => {
    expect(parseCreativeBrief("A clean product close-up").visualDirection).toBe("A clean product close-up");
  });

  it("rejects invalid enum, range, and future trend date inputs", () => {
    const { brief, errors } = validateCreativeBrief({
      objective: "viral",
      durationSeconds: 0,
      trendContext: "A claim",
      trendSource: "A source",
      trendObservedAt: "2999-01-01",
    });
    expect(errors.length).toBeGreaterThanOrEqual(3);
    expect(brief.objective).toBe("");
    expect(brief.durationSeconds).toBeNull();
    expect(brief.trendObservedAt).toBe("");
  });
});
