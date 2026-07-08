import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const LLM_API_KEY = process.env.LLM_API_KEY;
// Configurable model; defaults to a current Gemini model (gemini-1.5-flash was retired).
const LLM_MODEL = process.env.LLM_MODEL || "gemini-2.5-flash";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { visual_concept, caption, brand, format } = body;

    if (!LLM_API_KEY) {
      console.warn("[BFF Suggest] LLM_API_KEY is not configured in server environment.");
      return NextResponse.json(
        { 
          status: "error", 
          message: "AI suggestion service is not configured on this server." 
        },
        { status: 501 }
      );
    }

    const structuredPrompt = `Role:
You are an experienced social media strategist.

Context:
Brand: ${brand || "Default Brand"}
Format: ${format || "Single Image"}

Visual Concept:
${visual_concept || "None provided"}

Current Caption:
${caption || ""}

Objective:
Improve the caption while ensuring it aligns with the planned visual concept.

Output Requirements:
• Bahasa Indonesia
• Friendly and persuasive
• Maximum 300 characters
• Include a natural CTA
• Suggest relevant hashtags
• Keep the tone consistent with the visual concept`;

    console.log("[BFF Suggest] Requesting suggestion from Google Gemini API...");
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${LLM_MODEL}:generateContent?key=${LLM_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: structuredPrompt
            }]
          }]
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.warn(`[BFF Suggest] Gemini API call failed: ${geminiRes.status} - ${errText}`);
      return NextResponse.json(
        { 
          status: "error", 
          message: "Failed to fetch response from AI engine." 
        },
        { status: 502 }
      );
    }

    const data = await geminiRes.json();
    const suggestions = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    return NextResponse.json({
      status: "success",
      suggestions: suggestions.trim()
    });

  } catch (error: any) {
    console.error("[BFF Suggest] Error generating suggestions:", error);
    return NextResponse.json(
      { 
        status: "error", 
        message: error.message || "Failed to generate suggestions." 
      },
      { status: 500 }
    );
  }
}
