import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const FASTAPI_URL = process.env.FASTAPI_URL || "http://127.0.0.1:8000";

// GET Handler to query retrain status
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const job_id = searchParams.get("job_id");

    if (!job_id) {
      return NextResponse.json(
        { status: "error", message: "Parameter job_id is required." },
        { status: 400 }
      );
    }

    const cookieStore = await cookies();
    const accessToken = cookieStore.get("sb-access-token")?.value;
    const backendHeaders: Record<string, string> = {};
    if (accessToken) {
      backendHeaders["Authorization"] = `Bearer ${accessToken}`;
    }

    console.log(`[BFF Proxy] Fetching retrain job status: ${FASTAPI_URL}/train/${job_id}`);
    const response = await fetch(`${FASTAPI_URL}/train/${job_id}`, {
      headers: backendHeaders,
    });

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json(
        { status: "error", message: `FastAPI error: ${errText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("[BFF Proxy] Failed to fetch retrain status:", error);
    return NextResponse.json(
      { status: "error", message: error.message || "Failed to fetch retrain status" },
      { status: 500 }
    );
  }
}

// POST Handler to trigger retraining
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { brand_id, niche } = body;

    const cookieStore = await cookies();
    const accessToken = cookieStore.get("sb-access-token")?.value;
    const backendHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (accessToken) {
      backendHeaders["Authorization"] = `Bearer ${accessToken}`;
    }

    console.log(`[BFF Proxy] Forwarding retrain request to FastAPI: ${FASTAPI_URL}/train`);
    const response = await fetch(`${FASTAPI_URL}/train`, {
      method: "POST",
      headers: backendHeaders,
      body: JSON.stringify({
        brand_id: brand_id || null,
        niche: niche || null
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json(
        { status: "error", message: `FastAPI error: ${errText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("[BFF Proxy] Failed to trigger model retraining:", error);
    return NextResponse.json(
      { status: "error", message: error.message || "Failed to trigger retraining" },
      { status: 500 }
    );
  }
}
