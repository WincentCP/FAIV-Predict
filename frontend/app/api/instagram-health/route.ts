import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Proxies the ML service's Instagram connection health check: live token
// validation per linked brand plus the last successful sync timestamp.
const FASTAPI_URL = process.env.FASTAPI_URL || "http://127.0.0.1:8000";
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN;

export async function GET() {
  try {
    const backendHeaders: Record<string, string> = {};
    if (INTERNAL_API_TOKEN) {
      backendHeaders["X-Internal-Token"] = INTERNAL_API_TOKEN;
    }

    let mlResponse;
    try {
      mlResponse = await fetch(`${FASTAPI_URL}/instagram/health`, {
        headers: backendHeaders,
      });
    } catch (netErr: any) {
      console.error("[BFF InstagramHealth] FastAPI service is unreachable:", netErr.message);
      return NextResponse.json(
        { status: "error", message: "Connection health service is unreachable." },
        { status: 503 }
      );
    }

    if (!mlResponse.ok) {
      const errText = await mlResponse.text();
      return NextResponse.json(
        { status: "error", message: `FastAPI error: ${errText}` },
        { status: mlResponse.status }
      );
    }

    const data = await mlResponse.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("[BFF InstagramHealth] Fatal error:", error);
    return NextResponse.json(
      { status: "error", message: error.message || "Failed to fetch connection health" },
      { status: 500 }
    );
  }
}
