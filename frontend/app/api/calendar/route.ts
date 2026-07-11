import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRequestUser, getOwnedBrands } from "@/lib/authz";
import {
  PublicRequestError,
  publicErrorResponse,
  readJsonObject,
} from "@/lib/http-errors";

export const dynamic = "force-dynamic";

const VOICE_OVER = new Set(["Need", "No Need", "Done"]);
const STATUSES = new Set(["Need Shooting", "Need Design", "Need Editing", "Screening", "Ready to Post", "Posted"]);
const CONTENT_TYPES = new Set(["Reels", "Carousel", "Single Image", "Unspecified"]);
const WRITABLE = new Set([
  "brand_id", "posting_date", "posting_time", "content_type", "content_details",
  "visual_reference", "caption", "voice_over", "pic", "status",
]);

function cleanEntry(input: unknown, ownedBrandIds: Set<string>) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new PublicRequestError("Each calendar row must be a valid object.");
  }
  const entry = input as Record<string, unknown>;
  const postingDate = String(entry.posting_date || "");
  const parsedDate = new Date(`${postingDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(postingDate) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== postingDate) {
    throw new PublicRequestError("Posting date must be a real date in YYYY-MM-DD format.");
  }
  if (entry.brand_id !== undefined && entry.brand_id !== null && typeof entry.brand_id !== "string") {
    throw new PublicRequestError("Calendar brand must be a valid workspace brand.");
  }
  if (typeof entry.brand_id === "string" && entry.brand_id && !ownedBrandIds.has(entry.brand_id)) {
    throw new PublicRequestError("Calendar entry references a brand outside this workspace.");
  }
  const brandId = typeof entry.brand_id === "string" && entry.brand_id ? entry.brand_id : null;
  const voiceOver = typeof entry.voice_over === "string" && VOICE_OVER.has(entry.voice_over)
    ? entry.voice_over
    : null;
  const status = typeof entry.status === "string" && STATUSES.has(entry.status)
    ? entry.status
    : null;
  const rawPostingTime = String(entry.posting_time || "");
  if (rawPostingTime && !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(rawPostingTime)) {
    throw new PublicRequestError("Posting time must use 24-hour HH:MM format.");
  }
  const postingTime = rawPostingTime ? rawPostingTime.slice(0, 5) : null;
  const requestedType = String(entry.content_type || "").trim();
  const contentType = CONTENT_TYPES.has(requestedType) ? requestedType : "Unspecified";
  return {
    brand_id: brandId,
    posting_date: postingDate,
    posting_time: postingTime,
    content_type: contentType,
    content_details: typeof entry.content_details === "string" ? entry.content_details : null,
    visual_reference: typeof entry.visual_reference === "string" ? entry.visual_reference : null,
    caption: typeof entry.caption === "string" ? entry.caption : null,
    voice_over: voiceOver,
    pic: typeof entry.pic === "string" ? entry.pic.slice(0, 255) : null,
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
  } catch (error) {
    console.error("[BFF Calendar] Failed to load entries:", error);
    return publicErrorResponse(error, "Calendar entries are temporarily unavailable.", 503);
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const user = await getRequestUser(supabase);
    if (!user) return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
    const ownedBrands = await getOwnedBrands(supabase, user.id);
    const ownedBrandIds = new Set(ownedBrands.map((brand) => brand.id));
    const payload = await readJsonObject(request);
    const inputs = Array.isArray(payload.entries) ? payload.entries : [payload];
    if (inputs.length === 0 || inputs.length > 500) {
      return NextResponse.json({ status: "error", message: "Import must contain 1 to 500 rows." }, { status: 400 });
    }
    const source = Array.isArray(payload.entries) ? "import" : "manual";
    const rows = inputs.map((input) => ({
      ...cleanEntry(input, ownedBrandIds),
      owner_id: user.id,
      source,
    }));
    const { data, error } = await supabase.from("calendar_entries").insert(rows).select();
    if (error) throw error;
    return NextResponse.json({ status: "success", entries: data || [] });
  } catch (error) {
    console.error("[BFF Calendar] Failed to create entries:", error);
    return publicErrorResponse(error, "Calendar entries could not be saved.", 503);
  }
}

export async function PATCH(request: Request) {
  try {
    const supabase = await createClient();
    const user = await getRequestUser(supabase);
    if (!user) return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
    const ownedBrands = await getOwnedBrands(supabase, user.id);
    const ownedBrandIds = new Set(ownedBrands.map((brand) => brand.id));
    const payload = await readJsonObject(request);
    if (typeof payload.id !== "string") {
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
  } catch (error) {
    console.error("[BFF Calendar] Failed to update entry:", error);
    return publicErrorResponse(error, "Calendar entry could not be updated.", 503);
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = await createClient();
    const user = await getRequestUser(supabase);
    if (!user) return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
    const { id } = await readJsonObject(request);
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
  } catch (error) {
    console.error("[BFF Calendar] Failed to delete entry:", error);
    return publicErrorResponse(error, "Calendar entry could not be deleted.", 503);
  }
}
