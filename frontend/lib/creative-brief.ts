export const CREATIVE_BRIEF_HEADER = "FAIV Creative Brief v1";

export const CREATIVE_OBJECTIVES = [
  "awareness",
  "engagement",
  "education",
  "conversion",
  "community",
] as const;

export const STORYTELLING_STYLES = [
  "problem_solution",
  "story_journey",
  "list_tips",
  "demo_tutorial",
  "before_after",
  "testimonial",
  "behind_the_scenes",
  "pov_skit",
  "other",
] as const;

export const CREATIVE_CTAS = [
  "none",
  "comment",
  "save",
  "share",
  "follow",
  "visit_profile",
  "visit_link",
  "buy_book",
  "other",
] as const;

export const CREATIVE_MATERIAL_TYPES = [
  "video_script",
  "storyboard",
  "design_notes",
  "creative_brief",
  "bullet_ideas",
  "rough_idea",
  "other",
] as const;

export type CreativeObjective = (typeof CREATIVE_OBJECTIVES)[number];
export type StorytellingStyle = (typeof STORYTELLING_STYLES)[number];
export type CreativeCta = (typeof CREATIVE_CTAS)[number];
export type CreativeMaterialType = (typeof CREATIVE_MATERIAL_TYPES)[number];

export interface CreativeBrief {
  objective: CreativeObjective | "";
  contentPillar: string;
  hook: string;
  storytellingStyle: StorytellingStyle | "";
  visualDirection: string;
  cta: CreativeCta | "";
  durationSeconds: number | null;
  slideCount: number | null;
  trendContext: string;
  trendSource: string;
  trendObservedAt: string;
}

export interface CreativeBriefValidation {
  brief: CreativeBrief;
  errors: string[];
}

const FIELD_LIMITS = {
  contentPillar: 120,
  hook: 240,
  visualDirection: 1_600,
  trendContext: 700,
  trendSource: 500,
} as const;

const LABELS = {
  objective: "Objective",
  contentPillar: "Content pillar",
  hook: "Hook",
  storytellingStyle: "Storytelling style",
  visualDirection: "Visual direction",
  cta: "CTA",
  durationSeconds: "Duration (seconds)",
  slideCount: "Slide count",
  trendContext: "Current context",
  trendSource: "Context source",
  trendObservedAt: "Context observed",
} as const;

const LABEL_TO_FIELD = new Map<string, keyof CreativeBrief>(
  Object.entries(LABELS).map(([field, label]) => [label, field as keyof CreativeBrief])
);

export function emptyCreativeBrief(): CreativeBrief {
  return {
    objective: "",
    contentPillar: "",
    hook: "",
    storytellingStyle: "",
    visualDirection: "",
    cta: "",
    durationSeconds: null,
    slideCount: null,
    trendContext: "",
    trendSource: "",
    trendObservedAt: "",
  };
}

function cleanPersistedText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n?/g, "\n").trim().slice(0, maxLength);
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isRealIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function enumValue<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fieldLabel: string,
  errors: string[]
): T[number] | "" {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || !allowed.includes(value)) {
    errors.push(`${fieldLabel} is not a supported option.`);
    return "";
  }
  return value as T[number];
}

function textValue(
  value: unknown,
  fieldLabel: string,
  maxLength: number,
  errors: string[]
): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") {
    errors.push(`${fieldLabel} must be text.`);
    return "";
  }
  const cleaned = value.replace(/\r\n?/g, "\n").trim();
  if (cleaned.length > maxLength) {
    errors.push(`${fieldLabel} must be at most ${maxLength.toLocaleString("en-US")} characters.`);
  }
  return cleaned.slice(0, maxLength);
}

function integerValue(
  value: unknown,
  fieldLabel: string,
  minimum: number,
  maximum: number,
  errors: string[]
): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    errors.push(`${fieldLabel} must be a whole number from ${minimum} to ${maximum}.`);
    return null;
  }
  return value;
}

/** Strict validation for browser-to-server Creative Brief payloads. */
export function validateCreativeBrief(input: unknown): CreativeBriefValidation {
  const errors: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { brief: emptyCreativeBrief(), errors: ["Creative brief must be a valid object."] };
  }
  const source = input as Record<string, unknown>;
  const brief: CreativeBrief = {
    objective: enumValue(source.objective, CREATIVE_OBJECTIVES, LABELS.objective, errors),
    contentPillar: textValue(
      source.contentPillar,
      LABELS.contentPillar,
      FIELD_LIMITS.contentPillar,
      errors
    ),
    hook: textValue(source.hook, LABELS.hook, FIELD_LIMITS.hook, errors),
    storytellingStyle: enumValue(
      source.storytellingStyle,
      STORYTELLING_STYLES,
      LABELS.storytellingStyle,
      errors
    ),
    visualDirection: textValue(
      source.visualDirection,
      LABELS.visualDirection,
      FIELD_LIMITS.visualDirection,
      errors
    ),
    cta: enumValue(source.cta, CREATIVE_CTAS, LABELS.cta, errors),
    durationSeconds: integerValue(source.durationSeconds, LABELS.durationSeconds, 1, 600, errors),
    slideCount: integerValue(source.slideCount, LABELS.slideCount, 2, 20, errors),
    trendContext: textValue(
      source.trendContext,
      LABELS.trendContext,
      FIELD_LIMITS.trendContext,
      errors
    ),
    trendSource: textValue(
      source.trendSource,
      LABELS.trendSource,
      FIELD_LIMITS.trendSource,
      errors
    ),
    trendObservedAt: textValue(source.trendObservedAt, LABELS.trendObservedAt, 10, errors),
  };

  if (brief.trendObservedAt && !isRealIsoDate(brief.trendObservedAt)) {
    errors.push("Context observed must be a real date in YYYY-MM-DD format.");
    brief.trendObservedAt = "";
  } else if (brief.trendObservedAt && brief.trendObservedAt > new Date().toISOString().slice(0, 10)) {
    errors.push("Context observed cannot be in the future.");
    brief.trendObservedAt = "";
  }
  if ((brief.trendSource || brief.trendObservedAt) && !brief.trendContext) {
    errors.push("Describe the current context before adding its source or date.");
  }
  if (brief.trendContext && !brief.trendSource) {
    errors.push("Add the source of the current context.");
  }
  if (brief.trendContext && !brief.trendObservedAt) {
    errors.push("Add when the current context was observed.");
  }

  return { brief, errors };
}

export function hasCreativeBriefContent(brief: CreativeBrief): boolean {
  return Boolean(
    brief.objective ||
      brief.contentPillar ||
      brief.hook ||
      brief.storytellingStyle ||
      brief.visualDirection ||
      brief.cta ||
      brief.durationSeconds !== null ||
      brief.slideCount !== null ||
      brief.trendContext
  );
}

export function hasUserTrendContext(brief: CreativeBrief): boolean {
  return Boolean(brief.trendContext.trim());
}

export function isStructuredCreativeBrief(value: unknown): value is string {
  return typeof value === "string" && (
    value.trim() === CREATIVE_BRIEF_HEADER || value.trim().startsWith(`${CREATIVE_BRIEF_HEADER}\n`)
  );
}

export function creativeBriefSummary(value: unknown): string {
  const brief = parseCreativeBrief(value);
  const summary = brief.hook || brief.contentPillar || brief.visualDirection || brief.objective || "";
  return oneLine(summary).slice(0, 160);
}

/** Human-readable storage format for calendar_entries.content_details. */
export function serializeCreativeBrief(input: CreativeBrief): string {
  const { brief } = validateCreativeBrief(input);
  if (!hasCreativeBriefContent(brief)) return "";

  const lines = [CREATIVE_BRIEF_HEADER];
  const append = (field: keyof CreativeBrief, value: string | number | null) => {
    if (value === "" || value === null) return;
    lines.push(`${LABELS[field]}: ${oneLine(String(value))}`);
  };
  append("objective", brief.objective);
  append("contentPillar", brief.contentPillar);
  append("hook", brief.hook);
  append("storytellingStyle", brief.storytellingStyle);
  append("visualDirection", brief.visualDirection);
  append("cta", brief.cta);
  append("durationSeconds", brief.durationSeconds);
  append("slideCount", brief.slideCount);
  append("trendContext", brief.trendContext);
  append("trendSource", brief.trendSource);
  append("trendObservedAt", brief.trendObservedAt);
  return lines.join("\n");
}

/**
 * Reads the versioned format and safely falls back for existing free-text
 * content_details by treating it as visual direction, without guessing labels.
 */
export function parseCreativeBrief(value: unknown): CreativeBrief {
  if (typeof value !== "string" || !value.trim()) return emptyCreativeBrief();
  const source = value.replace(/\r\n?/g, "\n").trim();
  if (!source.startsWith(`${CREATIVE_BRIEF_HEADER}\n`) && source !== CREATIVE_BRIEF_HEADER) {
    return {
      ...emptyCreativeBrief(),
      visualDirection: cleanPersistedText(source, FIELD_LIMITS.visualDirection),
    };
  }

  const raw: Record<string, unknown> = {};
  for (const line of source.split("\n").slice(1)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const field = LABEL_TO_FIELD.get(line.slice(0, separator).trim());
    if (!field || raw[field] !== undefined) continue;
    const stored = line.slice(separator + 1).trim();
    if (field === "durationSeconds" || field === "slideCount") {
      const parsed = Number(stored);
      raw[field] = Number.isInteger(parsed) ? parsed : null;
    } else {
      raw[field] = stored;
    }
  }
  return validateCreativeBrief(raw).brief;
}
