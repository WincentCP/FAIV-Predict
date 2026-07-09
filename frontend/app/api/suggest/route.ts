import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

// Proxies the ML service's Template Recommendation Engine (TRE): deterministic,
// niche-baseline parameter recommendations computed from the draft's features.
const FASTAPI_URL = process.env.FASTAPI_URL || "http://127.0.0.1:8000";
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN;

const ALLOWED_FORMATS = ["Reels", "Carousel", "Single Image"];

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { caption, format, post_hour, brand_id, niche } = body;

    if (typeof caption !== "string") {
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

    const cookieStore = await cookies();
    const accessToken = cookieStore.get("sb-access-token")?.value;
    const backendHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (accessToken) {
      backendHeaders["Authorization"] = `Bearer ${accessToken}`;
    }
    if (INTERNAL_API_TOKEN) {
      backendHeaders["X-Internal-Token"] = INTERNAL_API_TOKEN;
    }

    let mlResponse;
    try {
      mlResponse = await fetch(`${FASTAPI_URL}/suggest`, {
        method: "POST",
        headers: backendHeaders,
        body: JSON.stringify({
          caption,
          format,
          post_hour: hour,
          brand_id: brand_id || null,
          niche: niche || null,
        }),
      });
    } catch (netErr: any) {
      console.error("[BFF Suggest] FastAPI service is unreachable:", netErr.message);
      return NextResponse.json(
        { status: "error", message: "Recommendation service is unreachable." },
        { status: 503 }
      );
    }

    if (!mlResponse.ok) {
      const errText = await mlResponse.text();
      console.error(`[BFF Suggest] FastAPI returned ${mlResponse.status}:`, errText);
      return NextResponse.json(
        { status: "error", message: "Failed to compute recommendations." },
        { status: mlResponse.status }
      );
    }

    const data = await mlResponse.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("[BFF Suggest] Error generating recommendations:", error);
    return NextResponse.json(
      { status: "error", message: error.message || "Failed to generate recommendations." },
      { status: 500 }
    );
  }
}
