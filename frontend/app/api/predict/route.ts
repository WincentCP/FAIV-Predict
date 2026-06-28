import { NextResponse } from "next/server";
import { cookies } from "next/headers";

// Retrieve private FastAPI service URL from environment variables
const FASTAPI_URL = process.env.FASTAPI_URL || "http://127.0.0.1:8000";
const LLM_API_KEY = process.env.LLM_API_KEY;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { 
      is_carousel, 
      is_reels, 
      post_hour, 
      caption_length, 
      hashtag_count, 
      has_cta, 
      brand_id, 
      niche, 
      caption,
      enrich 
    } = body;

    // 1. Session Capturing: Extract Supabase JWT token from cookies
    const cookieStore = await cookies();
    const accessToken = cookieStore.get("sb-access-token")?.value;
    
    // Construct standard headers
    const backendHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    };
    
    // 2. Authorization Wrapping: Forward the JWT session token securely
    if (accessToken) {
      backendHeaders["Authorization"] = `Bearer ${accessToken}`;
    }

    // Map format names for FastAPI
    let format_type = "Single Image";
    if (is_reels === 1.0) format_type = "Reels";
    else if (is_carousel === 1.0) format_type = "Carousel";

    // 3. Secure Proxying: Forward request to FastAPI Inference Engine
    let mlResponse;
    try {
      console.log(`[BFF Proxy] Forwarding inference request to FastAPI: ${FASTAPI_URL}/predict`);
      mlResponse = await fetch(`${FASTAPI_URL}/predict`, {
        method: "POST",
        headers: backendHeaders,
        body: JSON.stringify({
          caption: caption || "",
          format: format_type,
          post_hour: post_hour !== undefined ? parseInt(post_hour) : 19,
          brand_id: brand_id || null,
          niche: niche || null
        }),
      });
    } catch (netErr: any) {
      // 4. FastAPI Service Unavailable Fallback (TC-20)
      console.error("[BFF Proxy] FastAPI service is unreachable:", netErr.message);
      return NextResponse.json(
        { 
          status: "error", 
          code: "FASTAPI_UNAVAILABLE",
          message: "Prediction service warming up or offline. Please try again in a few moments." 
        },
        { status: 503 }
      );
    }

    if (!mlResponse.ok) {
      const errText = await mlResponse.text();
      console.error(`[BFF Proxy] FastAPI returned error status ${mlResponse.status}:`, errText);
      return NextResponse.json(
        { status: "error", message: `FastAPI error: ${errText}` },
        { status: mlResponse.status }
      );
    }

    const prediction = await mlResponse.json();

    // 5. Google Gemini API Enrichment (Suggest Page Option)
    let suggestions = "";
    if (enrich && LLM_API_KEY) {
      try {
        console.log("[BFF Proxy] Requesting creative enrichment from Google Gemini API (gemini-1.5-flash)...");
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${LLM_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{
                parts: [{
                  text: `You are a social media copywriter assistant. Generate a highly engaging alternative Instagram caption based on:
                  - Current Caption: "${caption}"
                  - Current predicted performance: "${prediction.predicted_class}" (Confidence: ${prediction.confidence}%)
                  - Target Format: ${format_type}
                  
                  Tuliskan rekomendasi alternatif caption dalam Bahasa Indonesia yang ramah, persuasif, serta tambahkan CTA pemicu konversi dan tagar relevan. Harap batasi saran di bawah 300 karakter.`
                }]
              }]
            })
          }
        );

        if (geminiRes.ok) {
          const geminiData = await geminiRes.json();
          suggestions = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        } else {
          console.warn("[BFF Proxy] Gemini API call failed, status:", geminiRes.status);
        }
      } catch (geminiErr: any) {
        console.warn("[BFF Proxy] Gemini API call failed with exception:", geminiErr.message);
      }
    }

    // Combine ML prediction results with LLM suggestions
    return NextResponse.json({
      status: "success",
      predicted_class: prediction.predicted_class,
      confidence: prediction.confidence,
      probabilities: prediction.probabilities,
      model_metadata: prediction.model_metadata,
      suggestions: suggestions
    });

  } catch (error: any) {
    console.error("[BFF Proxy] Fatal error processing prediction request:", error);
    return NextResponse.json(
      { status: "error", message: error.message || "Failed to process prediction in BFF proxy" },
      { status: 500 }
    );
  }
}
