import "server-only";

import { PublicRequestError } from "@/lib/http-errors";
import { createClient } from "@/lib/supabase/server";
import { getRequestUser } from "@/lib/authz";
import {
  sanitizeBrandPatterns,
  type BrandPatternsPayload,
} from "@/lib/brand-patterns";

const FASTAPI_URL = process.env.FASTAPI_URL || "http://127.0.0.1:8000";
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface OwnedBrandContext {
  id: string;
  name: string;
  niche: string;
  profileSummary: string | null;
  timezone: string;
  ownerId: string;
}

export async function requireOwnedBrand(rawBrandId: unknown): Promise<OwnedBrandContext> {
  if (typeof rawBrandId !== "string" || !UUID_PATTERN.test(rawBrandId)) {
    throw new PublicRequestError("A valid brand ID is required.", 400);
  }
  const supabase = await createClient();
  const user = await getRequestUser(supabase);
  if (!user) throw new PublicRequestError("Unauthorized", 401);

  const { data, error } = await supabase
    .from("brands")
    .select("id, name, niche, profile_summary, timezone")
    .eq("id", rawBrandId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (error) {
    console.error("[BrandContext] Workspace lookup failed:", error.code);
    throw new PublicRequestError("The workspace database is temporarily unavailable.", 503);
  }
  if (!data) throw new PublicRequestError("Brand not found in this workspace.", 404);
  return {
    id: data.id,
    name: data.name,
    niche: data.niche,
    profileSummary: typeof data.profile_summary === "string" ? data.profile_summary : null,
    timezone: typeof data.timezone === "string" ? data.timezone : "Asia/Jakarta",
    ownerId: user.id,
  };
}

export type BrandPatternLoadResult =
  | { ok: true; data: BrandPatternsPayload }
  | { ok: false; status: number; message: string };

export async function loadBrandPatterns(
  brand: OwnedBrandContext
): Promise<BrandPatternLoadResult> {
  const headers: Record<string, string> = {};
  if (INTERNAL_API_TOKEN) headers["X-Internal-Token"] = INTERNAL_API_TOKEN;
  try {
    const response = await fetch(
      `${FASTAPI_URL}/brand/patterns?brand_id=${encodeURIComponent(brand.id)}`,
      {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      }
    );
    if (!response.ok) {
      console.warn("[BrandPatterns] Internal service returned status:", response.status);
      return {
        ok: false,
        status: response.status === 404 ? 404 : 503,
        message:
          response.status === 404
            ? "Brand history was not found."
            : "Brand pattern service is temporarily unavailable.",
      };
    }
    const payload: unknown = await response.json().catch(() => null);
    const safe = sanitizeBrandPatterns(payload, brand);
    if (!safe) {
      console.error("[BrandPatterns] Internal service returned an invalid contract.");
      return { ok: false, status: 502, message: "Brand pattern service returned an invalid response." };
    }
    return { ok: true, data: safe };
  } catch (error: unknown) {
    console.error(
      "[BrandPatterns] Internal service is unreachable:",
      error instanceof Error ? error.message : "unknown network error"
    );
    return { ok: false, status: 503, message: "Brand pattern service is temporarily unreachable." };
  }
}

const DIMENSION_LABELS: Record<string, string> = {
  format: "content format",
  posting_window: "posting window",
  day_type: "weekday/weekend",
  cta: "CTA usage",
  question: "question usage",
};

/** Safe, compact evidence for an LLM prompt; never includes captions or media IDs. */
export function brandPatternPromptContext(result: BrandPatternLoadResult): string {
  if (!result.ok || result.data.status === "empty") {
    return [
      "No eligible mature brand-history pattern summary is available.",
      "Do not infer audience demographics, historical creative preferences, or external trends.",
    ].join("\n");
  }
  const payload = result.data;
  const lines = [
    `Evidence: ${payload.evidence.eligible_posts} verified mature posts for this brand only.`,
    `Overall historical median engagement rate: ${payload.overall?.median_er ?? "unavailable"}%.`,
  ];
  for (const item of payload.highlights.slice(0, 5)) {
    lines.push(
      `Highest observed ${DIMENSION_LABELS[item.dimension] || item.dimension}: ${item.label}; median ER ${item.median_er}%; n=${item.sample_size}; evidence=${item.evidence_level}.`
    );
  }
  lines.push(
    "These are descriptive historical associations, not causal audience preferences.",
    "Audience demographics, visual/video style, content pillars, hooks/storytelling, seasonal effects, and external platform trends are not measured unless the user explicitly supplies them in the brief.",
    "External trend data is not connected. Never present user-supplied trend context as verified platform evidence."
  );
  return lines.join("\n");
}
