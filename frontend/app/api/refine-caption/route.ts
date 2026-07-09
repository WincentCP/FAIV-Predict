import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Optional LLM enrichment: rewrites the draft caption via Google Gemini.
// Returns 501 when the server has no LLM_API_KEY configured — the UI keeps
// working without this feature.
const LLM_API_KEY = process.env.LLM_API_KEY;
const LLM_MODEL = process.env.LLM_MODEL || "gemini-2.5-flash";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { visual_concept, caption, brand, format } = body;

    if (typeof caption !== "string" || !caption.trim()) {
      return NextResponse.json(
        { status: "error", message: "'caption' is required." },
        { status: 400 }
      );
    }

    if (!LLM_API_KEY) {
      return NextResponse.json(
        {
          status: "error",
          message: "AI caption refinement is not configured on this server.",
        },
        { status: 501 }
      );
    }

    const structuredPrompt = `Role:
You are an experienced social media strategist.

Context:
Brand: ${brand || "Unknown brand"}
Format: ${format || "Single Image"}

Visual Concept:
${visual_concept || "None provided"}

Current Caption:
${caption}

Objective:
Improve the caption while ensuring it aligns with the planned visual concept.

Output Requirements:
• Bahasa Indonesia
• Friendly and persuasive
• Maximum 300 characters
• Include a natural CTA
• Suggest relevant hashtags
• Keep the tone consistent with the visual concept
• Reply with the improved caption text only`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${LLM_MODEL}:generateContent?key=${LLM_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: structuredPrompt }],
            },
          ],
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.warn(`[BFF Refine] Gemini API call failed: ${geminiRes.status} - ${errText}`);
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
      suggestions: suggestion.trim(),
    });
  } catch (error: any) {
    console.error("[BFF Refine] Error generating caption refinement:", error);
    return NextResponse.json(
      { status: "error", message: error.message || "Failed to refine caption." },
      { status: 500 }
    );
  }
}
