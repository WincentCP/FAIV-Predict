import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRequestUser } from "@/lib/authz";

export const dynamic = "force-dynamic";

const FASTAPI_URL = process.env.FASTAPI_URL || "http://127.0.0.1:8000";
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN;

export async function POST(request: Request) {
  try {
    const { brand_id, media_id, caption } = await request.json();
    if (typeof brand_id !== "string" || typeof media_id !== "string" || !brand_id || !media_id) {
      return NextResponse.json(
        { status: "error", message: "Brand ID and media ID are required." },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const user = await getRequestUser(supabase);
    if (!user) return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
    const { data: ownedBrand } = await supabase
      .from("brands")
      .select("id")
      .eq("id", brand_id)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (!ownedBrand) {
      return NextResponse.json(
        { status: "error", message: "Brand not found in this workspace." },
        { status: 404 }
      );
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (INTERNAL_API_TOKEN) headers["X-Internal-Token"] = INTERNAL_API_TOKEN;
    const response = await fetch(`${FASTAPI_URL}/instagram/post-insights`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        brand_id: ownedBrand.id,
        media_id,
        caption: typeof caption === "string" ? caption : null,
        created_by: user.id,
      }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return NextResponse.json(
        { status: "error", message: data?.detail || "Post metrics are unavailable." },
        { status: response.status }
      );
    }
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json(
      { status: "error", message: error.message || "Failed to load post metrics" },
      { status: 500 }
    );
  }
}
