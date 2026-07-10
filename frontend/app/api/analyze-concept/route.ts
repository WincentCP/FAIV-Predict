import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Semantic analysis of the free-form Visual Concept brief via Gemini.
// Creator briefs are inherently messy — scripts, dialogue, camera notes,
// mixed Indonesian/English, emojis — so extraction is done by the LLM
// (reasoning task), NOT by the deterministic feature pipeline. The result is
// creative guidance; it never feeds the Random Forest, whose features must
// exist in historical training data.
const LLM_API_KEY = process.env.LLM_API_KEY;
const LLM_MODEL = process.env.LLM_MODEL || "gemini-2.5-flash";

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
    const body = await request.json();
    const { concept, caption, brand, format } = body;

    if (typeof concept !== "string" || concept.trim().length < 10) {
      return NextResponse.json(
        { status: "error", message: "Write at least a short concept description first." },
        { status: 400 }
      );
    }

    if (!LLM_API_KEY) {
      return NextResponse.json(
        { status: "error", message: "AI concept analysis is not configured on this server." },
        { status: 501 }
      );
    }

    const prompt = `You are a social media content strategist. Analyze the following raw creator brief for an Instagram ${format || "post"}${brand ? ` by the brand "${brand}"` : ""}. The brief may be messy: scripts, dialogue, camera directions, storyboards, mixed Indonesian/English, emojis, or loose keywords. Extract what you can; use null when a signal is genuinely absent. Never invent details.

RAW BRIEF:
"""
${concept.slice(0, 4000)}
"""
${caption ? `\nDRAFT CAPTION (context only):\n"""\n${String(caption).slice(0, 1000)}\n"""` : ""}

Reply with ONLY a valid JSON object (no markdown fences, no commentary) with exactly these keys:
{
  "content_type": one of ${JSON.stringify(CONTENT_TYPES)},
  "tone": short phrase describing the emotional tone (e.g. "playful and relatable"), or null,
  "pov_format": true if it uses POV framing, else false,
  "dialogue_heavy": true if it centers on dialogue/characters, else false,
  "scene_count": integer number of distinct scenes/shots if countable, else null,
  "hook": the opening hook line/idea if identifiable, else null,
  "product_visibility": "prominent" | "subtle" | "none",
  "cta_present": true if the concept plans an explicit call-to-action, else false,
  "strengths": array of at most 2 short sentences on what makes this concept work,
  "suggestions": array of at most 2 short, concrete improvement suggestions
}
Write strengths and suggestions in the same language the brief is mostly written in.`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${LLM_MODEL}:generateContent?key=${LLM_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
        }),
      }
    );

    if (geminiRes.ok) {
      const geminiData = await geminiRes.json();
      const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const clean = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
      try {
        const parsed = JSON.parse(clean);
        // Validate + normalize so the UI never renders junk.
        const result = {
          content_type: CONTENT_TYPES.includes(parsed.content_type) ? parsed.content_type : "Other",
          tone: typeof parsed.tone === "string" ? parsed.tone.slice(0, 80) : null,
          pov_format: Boolean(parsed.pov_format),
          dialogue_heavy: Boolean(parsed.dialogue_heavy),
          scene_count:
            Number.isInteger(parsed.scene_count) && parsed.scene_count > 0 && parsed.scene_count < 100
              ? parsed.scene_count
              : null,
          hook: typeof parsed.hook === "string" ? parsed.hook.slice(0, 160) : null,
          product_visibility: ["prominent", "subtle", "none"].includes(parsed.product_visibility)
            ? parsed.product_visibility
            : "none",
          cta_present: Boolean(parsed.cta_present),
          strengths: Array.isArray(parsed.strengths)
            ? parsed.strengths.filter((s: any) => typeof s === "string").slice(0, 2)
            : [],
          suggestions: Array.isArray(parsed.suggestions)
            ? parsed.suggestions.filter((s: any) => typeof s === "string").slice(0, 2)
            : [],
        };
        return NextResponse.json({ status: "success", analysis: result });
      } catch {
        console.error("[BFF AnalyzeConcept] Gemini response was not valid JSON:", clean.slice(0, 200));
      }
    } else {
      console.warn("[BFF AnalyzeConcept] Gemini API returned status:", geminiRes.status);
    }

    return NextResponse.json(
      { status: "error", message: "Concept analysis failed — try again in a moment." },
      { status: 502 }
    );
  } catch (error: any) {
    console.error("[BFF AnalyzeConcept] Fatal error:", error);
    return NextResponse.json(
      { status: "error", message: error.message || "Failed to analyze concept" },
      { status: 500 }
    );
  }
}
