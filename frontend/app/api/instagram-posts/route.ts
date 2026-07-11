import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRequestUser } from "@/lib/authz";

export const dynamic = "force-dynamic";

// Proxies live Instagram post insights from the ML service: media previews,
// engagement metrics, and ER tiers graded against the brand's own history.
const FASTAPI_URL = process.env.FASTAPI_URL || "http://127.0.0.1:8000";
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const brandId = searchParams.get("brand_id");
    if (!brandId) {
      return NextResponse.json(
        { status: "error", message: "Parameter 'brand_id' is required." },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const user = await getRequestUser(supabase);
    if (!user) return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
    const { data: ownedBrand } = await supabase
      .from("brands")
      .select("id, name")
      .eq("id", brandId)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (!ownedBrand) return NextResponse.json({ status: "error", message: "Brand not found in this workspace." }, { status: 404 });

    const backendHeaders: Record<string, string> = {};
    if (INTERNAL_API_TOKEN) {
      backendHeaders["X-Internal-Token"] = INTERNAL_API_TOKEN;
    }

    let mlResponse;
    try {
      mlResponse = await fetch(
        `${FASTAPI_URL}/instagram/posts?brand_id=${encodeURIComponent(ownedBrand.id)}`,
        { headers: backendHeaders }
      );
    } catch (netErr: any) {
      console.error("[BFF InstagramPosts] FastAPI service is unreachable:", netErr.message);
      return NextResponse.json(
        { status: "error", message: "Post insights service is unreachable." },
        { status: 503 }
      );
    }

    const data = await mlResponse.json().catch(() => null);
    if (!mlResponse.ok) {
      return NextResponse.json(
        { status: "error", message: data?.detail || "Failed to fetch post insights." },
        { status: mlResponse.status }
      );
    }
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("[BFF InstagramPosts] Fatal error:", error);
    return NextResponse.json(
      { status: "error", message: error.message || "Failed to fetch post insights" },
      { status: 500 }
    );
  }
}
