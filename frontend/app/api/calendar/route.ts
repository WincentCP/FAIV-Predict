import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRequestUser, getOwnedBrands } from "@/lib/authz";

export const dynamic = "force-dynamic";

const VOICE_OVER = new Set(["Need", "No Need", "Done"]);
const STATUSES = new Set(["Need Shooting", "Need Design", "Need Editing", "Screening", "Ready to Post", "Posted"]);
const WRITABLE = new Set([
  "brand_id", "posting_date", "posting_time", "content_type", "content_details",
  "visual_reference", "caption", "voice_over", "pic", "status",
]);

function cleanEntry(input: any, ownedBrandIds: Set<string>) {
  if (!input || typeof input !== "object") throw new Error("Invalid calendar entry.");
  const postingDate = String(input.posting_date || "");
  const parsedDate = new Date(`${postingDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(postingDate) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== postingDate) {
    throw new Error("Posting date must use YYYY-MM-DD.");
  }
  if (typeof input.brand_id === "string" && input.brand_id && !ownedBrandIds.has(input.brand_id)) {
    throw new Error("Calendar entry references a brand outside this workspace.");
  }
  const brandId = typeof input.brand_id === "string" && input.brand_id ? input.brand_id : null;
  const voiceOver = VOICE_OVER.has(input.voice_over) ? input.voice_over : null;
  const status = STATUSES.has(input.status) ? input.status : null;
  const postingTime = /^\d{2}:\d{2}(:\d{2})?$/.test(String(input.posting_time || ""))
    ? String(input.posting_time).slice(0, 5)
    : null;
  return {
    brand_id: brandId,
    posting_date: postingDate,
    posting_time: postingTime,
    content_type: String(input.content_type || "Single Image").trim().slice(0, 100) || "Single Image",
    content_details: typeof input.content_details === "string" ? input.content_details : null,
    visual_reference: typeof input.visual_reference === "string" ? input.visual_reference : null,
    caption: typeof input.caption === "string" ? input.caption : null,
    voice_over: voiceOver,
    pic: typeof input.pic === "string" ? input.pic.slice(0, 255) : null,
    status,
  };
}

export async function GET() {
  try {
    const supabase = await createClient();
    const user = await getRequestUser(supabase);
    if (!user) return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });

    const { data, error } = await supabase
      .from("calendar_entries")
      .select("id, brand_id, posting_date, posting_time, content_type, content_details, visual_reference, caption, voice_over, pic, status, source, prediction_id, created_at, brands(name)")
      .eq("owner_id", user.id)
      .order("posting_date", { ascending: true });
    if (error) throw error;
    return NextResponse.json(data || []);
  } catch (error: any) {
    return NextResponse.json(
      { status: "error", message: error.message || "Failed to load calendar entries" },
      { status: 503 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const user = await getRequestUser(supabase);
    if (!user) return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
    const ownedBrands = await getOwnedBrands(supabase, user.id);
    const ownedBrandIds = new Set(ownedBrands.map((brand) => brand.id));
    const payload = await request.json();
    const inputs = Array.isArray(payload?.entries) ? payload.entries : [payload];
    if (inputs.length === 0 || inputs.length > 500) {
      return NextResponse.json({ status: "error", message: "Import must contain 1 to 500 rows." }, { status: 400 });
    }
    const source = payload?.entries ? "import" : "manual";
    const rows = inputs.map((input: any) => ({
      ...cleanEntry(input, ownedBrandIds),
      owner_id: user.id,
      source,
    }));
    const { data, error } = await supabase.from("calendar_entries").insert(rows).select();
    if (error) throw error;
    return NextResponse.json({ status: "success", entries: data || [] });
  } catch (error: any) {
    return NextResponse.json(
      { status: "error", message: error.message || "Failed to create calendar entries" },
      { status: 400 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const supabase = await createClient();
    const user = await getRequestUser(supabase);
    if (!user) return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
    const ownedBrands = await getOwnedBrands(supabase, user.id);
    const ownedBrandIds = new Set(ownedBrands.map((brand) => brand.id));
    const payload = await request.json();
    if (typeof payload?.id !== "string") {
      return NextResponse.json({ status: "error", message: "Entry ID is required." }, { status: 400 });
    }
    const cleaned = cleanEntry(payload, ownedBrandIds);
    const updates = Object.fromEntries(Object.entries(cleaned).filter(([key]) => WRITABLE.has(key)));
    const { data, error } = await supabase
      .from("calendar_entries")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", payload.id)
      .eq("owner_id", user.id)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ status: "error", message: "Entry not found." }, { status: 404 });
    return NextResponse.json({ status: "success", entry: data });
  } catch (error: any) {
    return NextResponse.json(
      { status: "error", message: error.message || "Failed to update calendar entry" },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = await createClient();
    const user = await getRequestUser(supabase);
    if (!user) return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
    const { id } = await request.json();
    if (typeof id !== "string") {
      return NextResponse.json({ status: "error", message: "Entry ID is required." }, { status: 400 });
    }
    const { data, error } = await supabase
      .from("calendar_entries")
      .delete()
      .eq("id", id)
      .eq("owner_id", user.id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ status: "error", message: "Entry not found." }, { status: 404 });
    return NextResponse.json({ status: "success" });
  } catch (error: any) {
    return NextResponse.json(
      { status: "error", message: error.message || "Failed to delete calendar entry" },
      { status: 400 }
    );
  }
}
