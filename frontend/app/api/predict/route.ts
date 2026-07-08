import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

// Retrieve private FastAPI service URL from environment variables
const FASTAPI_URL = process.env.FASTAPI_URL || "http://127.0.0.1:8000";
const LLM_API_KEY = process.env.LLM_API_KEY;
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN;

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

    // Service-to-service shared secret for the ML service
    if (INTERNAL_API_TOKEN) {
      backendHeaders["X-Internal-Token"] = INTERNAL_API_TOKEN;
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

    // Return ML prediction results directly
    return NextResponse.json({
      status: "success",
      predicted_class: prediction.predicted_class,
      confidence: prediction.confidence,
      probabilities: prediction.probabilities,
      model_metadata: prediction.model_metadata,
      feature_importances: prediction.feature_importances
    });

  } catch (error: any) {
    console.error("[BFF Proxy] Fatal error processing prediction request:", error);
    return NextResponse.json(
      { status: "error", message: error.message || "Failed to process prediction in BFF proxy" },
      { status: 500 }
    );
  }
}
