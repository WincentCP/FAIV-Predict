import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Private FastAPI service URL (server-side only)
const FASTAPI_URL = process.env.FASTAPI_URL || "http://127.0.0.1:8000";
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN;

const ALLOWED_FORMATS = ["Reels", "Carousel", "Single Image"];

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { caption, format, post_hour, brand_id, niche, scheduled_date } = body;

    // Input validation — reject malformed requests before they hit the model.
    if (typeof caption !== "string" || !caption.trim()) {
      return NextResponse.json(
        { status: "error", message: "'caption' is required." },
        { status: 400 }
      );
    }
    if (!ALLOWED_FORMATS.includes(format)) {
      return NextResponse.json(
        { status: "error", message: `'format' must be one of: ${ALLOWED_FORMATS.join(", ")}.` },
        { status: 400 }
      );
    }
    const hour = Number(post_hour);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      return NextResponse.json(
        { status: "error", message: "'post_hour' must be an integer between 0 and 23." },
        { status: 400 }
      );
    }
    if (scheduled_date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(scheduled_date))) {
      return NextResponse.json(
        { status: "error", message: "'scheduled_date' must be an ISO date (YYYY-MM-DD)." },
        { status: 400 }
      );
    }

    // Service-to-service secret: the middleware already gates this route behind
    // a Supabase session; the ML service trusts the shared internal token.
    const backendHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (INTERNAL_API_TOKEN) {
      backendHeaders["X-Internal-Token"] = INTERNAL_API_TOKEN;
    }

    let mlResponse;
    try {
      mlResponse = await fetch(`${FASTAPI_URL}/predict`, {
        method: "POST",
        headers: backendHeaders,
        body: JSON.stringify({
          caption,
          format,
          post_hour: hour,
          brand_id: brand_id || null,
          niche: niche || null,
          scheduled_date: scheduled_date || null,
        }),
      });
    } catch (netErr: any) {
      console.error("[BFF Proxy] FastAPI service is unreachable:", netErr.message);
      return NextResponse.json(
        {
          status: "error",
          code: "FASTAPI_UNAVAILABLE",
          message: "Prediction service is unreachable. Please try again in a few moments.",
        },
        { status: 503 }
      );
    }

    if (!mlResponse.ok) {
      let message = `Prediction service error (HTTP ${mlResponse.status}).`;
      try {
        const errJson = await mlResponse.json();
        if (errJson?.detail) message = String(errJson.detail);
      } catch {
        // non-JSON error body — keep the generic message
      }
      console.error(`[BFF Proxy] FastAPI returned ${mlResponse.status}: ${message}`);
      return NextResponse.json(
        { status: "error", message },
        { status: mlResponse.status }
      );
    }

    const prediction = await mlResponse.json();

    return NextResponse.json({
      status: "success",
      predicted_class: prediction.predicted_class,
      confidence: prediction.confidence,
      probabilities: prediction.probabilities,
      prediction_id: prediction.prediction_id ?? null,
      model_metadata: prediction.model_metadata ?? null,
      feature_importances: prediction.feature_importances,
    });
  } catch (error: any) {
    console.error("[BFF Proxy] Fatal error processing prediction request:", error);
    return NextResponse.json(
      { status: "error", message: error.message || "Failed to process prediction in BFF proxy" },
      { status: 500 }
    );
  }
}
