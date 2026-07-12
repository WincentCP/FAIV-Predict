import { NextResponse } from "next/server";
import { publicErrorResponse, readJsonObject } from "@/lib/http-errors";
import {
  brandPatternPromptContext,
  loadBrandPatterns,
  requireOwnedBrand,
} from "@/lib/server/brand-pattern-context";

export const dynamic = "force-dynamic";

const LLM_API_KEY = process.env.LLM_API_KEY;
const LLM_MODEL = process.env.LLM_MODEL || "gemini-2.5-flash";
const SUPPORTED_FORMATS = new Set(["Reels", "Carousel", "Single Image"]);

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    const brand = await requireOwnedBrand(body.brand_id);
    const { visual_concept, caption, format } = body;

    if (typeof caption !== "string" || !caption.trim()) {
      return NextResponse.json(
        { status: "error", message: "'caption' is required." },
        { status: 400 }
      );
    }
    if (caption.length > 5000) {
      return NextResponse.json(
        { status: "error", message: "Caption must be at most 5,000 characters." },
        { status: 400 }
      );
    }
    if (typeof visual_concept === "string" && visual_concept.length > 4000) {
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
        { status: "error", message: "AI caption refinement is not configured on this server." },
        { status: 501 }
      );
    }

    const safeFormat = format;
    const safeConcept =
      typeof visual_concept === "string" && visual_concept.trim()
        ? visual_concept
        : "None provided";
    const patterns = await loadBrandPatterns(brand);
    const evidenceContext = brandPatternPromptContext(patterns);

    const structuredPrompt = `Role:
You are a careful social media strategist and copywriter.

Brand context:
Brand: ${brand.name}
Niche: ${brand.niche}
Format: ${safeFormat}

Safe historical evidence:
${evidenceContext}

User-supplied creative brief:
${safeConcept}

Current caption:
${caption}

Objective:
Improve the caption while keeping it consistent with the user's creative brief and brand identity.

Evidence rules:
• Historical summaries are descriptive, not causal audience preferences.
• Do not invent demographics, visual preferences, seasonality, or platform trends.
• Treat campaign, season, and trend statements in the brief as user-supplied planning context, not verified external evidence.
• Do not claim that this rewrite will improve performance.

Output requirements:
• Bahasa Indonesia
• Friendly and persuasive
• Maximum 300 characters
• Include a natural CTA when appropriate
• Suggest a small, relevant hashtag set
• Keep the tone consistent with the brief
• Reply with the improved caption text only`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${LLM_MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": LLM_API_KEY,
        },
        body: JSON.stringify({ contents: [{ parts: [{ text: structuredPrompt }] }] }),
        signal: AbortSignal.timeout(25_000),
      }
    );

    if (!geminiRes.ok) {
      console.warn(`[BFF Refine] Gemini API call failed with status ${geminiRes.status}.`);
      return NextResponse.json(
        { status: "error", message: "Failed to fetch response from AI engine." },
        { status: 502 }
      );
    }

    const data = await geminiRes.json();
    const suggestion = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (!suggestion.trim()) {
      return NextResponse.json(
        { status: "error", message: "AI engine returned an empty response." },
        { status: 502 }
      );
    }

    return NextResponse.json({
      status: "success",
      suggestions: suggestion.trim().slice(0, 1000),
      analysis_context: {
        historical_patterns_used:
          patterns.ok && patterns.data.status === "success" && patterns.data.evidence.eligible_posts > 0,
        external_trends_used: false,
        audience_demographics_used: false,
        prediction_features_changed: false,
      },
    });
  } catch (error: unknown) {
    console.error(
      "[BFF Refine] Request failed:",
      error instanceof Error ? error.name : "unknown error"
    );
    return publicErrorResponse(error, "Caption refinement could not be completed.", 500);
  }
}
