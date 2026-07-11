import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRequestUser } from "@/lib/authz";

export const dynamic = "force-dynamic";

const FASTAPI_URL = process.env.FASTAPI_URL || "http://127.0.0.1:8000";
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN;

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

    const supabase = await createClient();
    const user = await getRequestUser(supabase);
    if (!user) return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
    const { data: job } = await supabase
      .from("model_retrain_jobs")
      .select("id, brands!inner(owner_id)")
      .eq("id", job_id)
      .eq("brands.owner_id", user.id)
      .maybeSingle();
    if (!job) return NextResponse.json({ status: "error", message: "Retrain job not found." }, { status: 404 });

    const backendHeaders: Record<string, string> = {};
    if (INTERNAL_API_TOKEN) {
      backendHeaders["X-Internal-Token"] = INTERNAL_API_TOKEN;
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
    const { brand_id } = body;
    const supabase = await createClient();
    const user = await getRequestUser(supabase);
    if (!user) return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
    if (typeof brand_id !== "string" || !brand_id) {
      return NextResponse.json({ status: "error", message: "A registered brand is required." }, { status: 400 });
    }
    const { data: ownedBrand } = await supabase
      .from("brands")
      .select("id, niche")
      .eq("id", brand_id)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (!ownedBrand) return NextResponse.json({ status: "error", message: "Brand not found in this workspace." }, { status: 404 });

    const backendHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (INTERNAL_API_TOKEN) {
      backendHeaders["X-Internal-Token"] = INTERNAL_API_TOKEN;
    }

    console.log(`[BFF Proxy] Forwarding retrain request to FastAPI: ${FASTAPI_URL}/train`);
    const response = await fetch(`${FASTAPI_URL}/train`, {
      method: "POST",
      headers: backendHeaders,
      body: JSON.stringify({
        brand_id: brand_id || null,
        niche: ownedBrand.niche
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
