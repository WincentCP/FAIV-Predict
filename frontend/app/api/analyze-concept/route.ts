import { NextResponse } from "next/server";
import { publicErrorResponse, readJsonObject } from "@/lib/http-errors";
import {
  brandPatternPromptContext,
  loadBrandPatterns,
  requireOwnedBrand,
} from "@/lib/server/brand-pattern-context";

export const dynamic = "force-dynamic";

// Semantic analysis of the user-supplied Creative Brief via Gemini. The result
// is planning guidance and never feeds the Random Forest.
const LLM_API_KEY = process.env.LLM_API_KEY;
const LLM_MODEL = process.env.LLM_MODEL || "gemini-2.5-flash";
const SUPPORTED_FORMATS = new Set(["Reels", "Carousel", "Single Image"]);

const CONTENT_TYPES = [
  "Comedy / Skit",
  "Product Showcase",
  "Educational",
  "Storytelling",
  "Behind the Scenes",
  "Trend / Challenge",
  "Announcement / Promo",
  "Other",
];

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    const brand = await requireOwnedBrand(body.brand_id);
    const { concept, caption, format } = body;

    if (typeof concept !== "string" || concept.trim().length < 10) {
      return NextResponse.json(
        { status: "error", message: "Write at least a short concept description first." },
        { status: 400 }
      );
    }
    if (concept.length > 4000) {
      return NextResponse.json(
        { status: "error", message: "Creative brief must be at most 4,000 characters." },
        { status: 400 }
      );
    }
    if (typeof format !== "string" || !SUPPORTED_FORMATS.has(format)) {
      return NextResponse.json(
        { status: "error", message: "Format must be Reels, Carousel, or Single Image." },
        { status: 400 }
      );
    }
    if (!LLM_API_KEY) {
      return NextResponse.json(
        { status: "error", message: "AI concept analysis is not configured on this server." },
        { status: 501 }
      );
    }

    const patterns = await loadBrandPatterns(brand);
    const safeFormat = format;
    const safeCaption = typeof caption === "string" ? caption.slice(0, 1000) : "";
    const evidenceContext = brandPatternPromptContext(patterns);
    const prompt = `You are a careful social media content strategist. Analyze the following USER-SUPPLIED creative brief for an Instagram ${safeFormat} by the brand "${brand.name}" in the "${brand.niche}" niche. The brief may contain content pillars, visual/video style, hooks, storytelling, scripts, dialogue, camera notes, campaign season, and trend ideas. Extract only what is actually present; use null when a signal is absent. Never invent details.

SAFE HISTORICAL CONTEXT:
${evidenceContext}

USER-SUPPLIED BRAND PROFILE (identity context only; never historical evidence):
"""
${brand.profileSummary || "Not supplied."}
"""

EVIDENCE RULES:
- Historical summaries are descriptive associations, not causal audience preferences.
- Do not claim access to audience demographics, platform-wide trends, seasonality, or media-vision analysis.
- Treat any campaign, season, or trend in the brief as user-supplied context, not verified external evidence.
- Treat the brand profile as user-supplied identity context. Never claim it was learned from Instagram audience data.
- If you reference historical context, qualify it as "observed in this brand's eligible history" and include no stronger claim.
- The brief and this analysis are not Random Forest inputs and do not change the prediction score.

USER-SUPPLIED CREATIVE BRIEF:
"""
${concept}
"""
${safeCaption ? `\nDRAFT CAPTION (context only):\n"""\n${safeCaption}\n"""` : ""}

Reply with ONLY a valid JSON object (no markdown fences, no commentary) with exactly these keys:
{
  "content_type": one of ${JSON.stringify(CONTENT_TYPES)},
  "tone": short phrase describing the emotional tone, or null,
  "pov_format": true if it uses POV framing, else false,
  "dialogue_heavy": true if it centers on dialogue/characters, else false,
  "scene_count": integer number of distinct scenes/shots if countable, else null,
  "hook": the opening hook line/idea if identifiable, else null,
  "product_visibility": "prominent" | "subtle" | "none",
  "cta_present": true if the concept plans an explicit call-to-action, else false,
  "strengths": array of at most 2 short sentences on what makes this concept coherent,
  "suggestions": array of at most 2 short, concrete improvement hypotheses
}
Write strengths and suggestions in the same language the brief is mostly written in.`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${LLM_MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": LLM_API_KEY,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
        }),
        signal: AbortSignal.timeout(25_000),
      }
    );

    if (geminiRes.ok) {
      const geminiData = await geminiRes.json();
      const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const clean = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
      try {
        const parsed: Record<string, unknown> = JSON.parse(clean);
        const result = {
          content_type:
            typeof parsed.content_type === "string" && CONTENT_TYPES.includes(parsed.content_type)
              ? parsed.content_type
              : "Other",
          tone: typeof parsed.tone === "string" ? parsed.tone.slice(0, 80) : null,
          pov_format: parsed.pov_format === true,
          dialogue_heavy: parsed.dialogue_heavy === true,
          scene_count:
            Number.isInteger(parsed.scene_count) &&
            typeof parsed.scene_count === "number" &&
            parsed.scene_count > 0 &&
            parsed.scene_count < 100
              ? parsed.scene_count
              : null,
          hook: typeof parsed.hook === "string" ? parsed.hook.slice(0, 160) : null,
          product_visibility:
            typeof parsed.product_visibility === "string" &&
            ["prominent", "subtle", "none"].includes(parsed.product_visibility)
              ? parsed.product_visibility
              : "none",
          cta_present: parsed.cta_present === true,
          strengths: Array.isArray(parsed.strengths)
            ? parsed.strengths
                .filter((item): item is string => typeof item === "string")
                .slice(0, 2)
                .map((item) => item.slice(0, 240))
            : [],
          suggestions: Array.isArray(parsed.suggestions)
            ? parsed.suggestions
                .filter((item): item is string => typeof item === "string")
                .slice(0, 2)
                .map((item) => item.slice(0, 240))
            : [],
        };
        return NextResponse.json({
          status: "success",
          analysis: result,
          analysis_context: {
            historical_patterns_used:
              patterns.ok && patterns.data.status === "success" && patterns.data.evidence.eligible_posts > 0,
            external_trends_used: false,
            audience_demographics_used: false,
            prediction_features_changed: false,
          },
        });
      } catch {
        console.error("[BFF AnalyzeConcept] Gemini response was not valid JSON.");
      }
    } else {
      console.warn("[BFF AnalyzeConcept] Gemini API returned status:", geminiRes.status);
    }

    return NextResponse.json(
      { status: "error", message: "Concept analysis failed—try again in a moment." },
      { status: 502 }
    );
  } catch (error: unknown) {
    console.error(
      "[BFF AnalyzeConcept] Request failed:",
      error instanceof Error ? error.name : "unknown error"
    );
    return publicErrorResponse(error, "Concept analysis could not be completed.", 500);
  }
}
