import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/authz";
import { PublicRequestError, publicErrorResponse, readJsonObject } from "@/lib/http-errors";
import { createClient } from "@/lib/supabase/server";
import {
  isRealPastOrTodayDate,
  isTrendNoteStale,
  TREND_NOTE_MAX_LENGTH,
  TREND_SOURCE_MAX_LENGTH,
  TREND_TAG_MAX_LENGTH,
  type TrendNote,
} from "@/lib/trend-notes";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function shapeTrendNote(row: any): TrendNote {
  return {
    id: row.id,
    brand_id: row.brand_id,
    note: String(row.note).slice(0, TREND_NOTE_MAX_LENGTH),
    source: String(row.source).slice(0, TREND_SOURCE_MAX_LENGTH),
    observed_at: row.observed_at,
    tag: typeof row.tag === "string" ? row.tag.slice(0, TREND_TAG_MAX_LENGTH) : null,
    created_at: row.created_at,
    is_stale: isTrendNoteStale(row.observed_at),
  };
}

async function requireContext(brandId?: unknown) {
  if (brandId !== undefined && (typeof brandId !== "string" || !UUID_PATTERN.test(brandId))) {
    throw new PublicRequestError("A valid brand ID is required.", 400);
  }
  const supabase = await createClient();
  const user = await getRequestUser(supabase);
  if (!user) throw new PublicRequestError("Unauthorized", 401);
  if (typeof brandId === "string") {
    const { data: brand, error } = await supabase
      .from("brands")
      .select("id")
      .eq("id", brandId)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (error) throw error;
    if (!brand) throw new PublicRequestError("Brand not found in this workspace.", 404);
  }
  return { supabase, user };
}

export async function GET(request: Request) {
  try {
    const brandId = new URL(request.url).searchParams.get("brand_id");
    const { supabase, user } = await requireContext(brandId);
    const { data, error } = await supabase
      .from("brand_trend_notes")
      .select("id, brand_id, note, source, observed_at, tag, created_at")
      .eq("brand_id", brandId as string)
      .eq("created_by", user.id)
      .order("observed_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    const response = NextResponse.json({
      status: "success",
      notes: (data || []).map(shapeTrendNote),
    });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    console.error("[BFF TrendNotes] Failed to load notes:", error instanceof Error ? error.name : "unknown");
    return publicErrorResponse(error, "Trend notes are temporarily unavailable.", 503);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    const { supabase, user } = await requireContext(body.brand_id);
    const note = typeof body.note === "string" ? body.note.trim() : "";
    const source = typeof body.source === "string" ? body.source.trim() : "";
    const observedAt = typeof body.observed_at === "string" ? body.observed_at : "";
    const tag = body.tag === undefined || body.tag === null || body.tag === ""
      ? null
      : typeof body.tag === "string" ? body.tag.trim() : "";
    if (!note || note.length > TREND_NOTE_MAX_LENGTH) {
      throw new PublicRequestError(`Trend note must contain 1 to ${TREND_NOTE_MAX_LENGTH} characters.`, 400);
    }
    if (!source || source.length > TREND_SOURCE_MAX_LENGTH) {
      throw new PublicRequestError(`Trend source must contain 1 to ${TREND_SOURCE_MAX_LENGTH} characters.`, 400);
    }
    if (!isRealPastOrTodayDate(observedAt)) {
      throw new PublicRequestError("Observed date must be a real date that is not in the future.", 400);
    }
    if (tag !== null && (!tag || tag.length > TREND_TAG_MAX_LENGTH)) {
      throw new PublicRequestError(`Trend tag must contain 1 to ${TREND_TAG_MAX_LENGTH} characters.`, 400);
    }
    const { data, error } = await supabase
      .from("brand_trend_notes")
      .insert({
        brand_id: body.brand_id,
        note,
        source,
        observed_at: observedAt,
        tag,
        created_by: user.id,
      })
      .select("id, brand_id, note, source, observed_at, tag, created_at")
      .single();
    if (error) throw error;
    return NextResponse.json({ status: "success", note: shapeTrendNote(data) }, { status: 201 });
  } catch (error) {
    console.error("[BFF TrendNotes] Failed to create note:", error instanceof Error ? error.name : "unknown");
    return publicErrorResponse(error, "Trend note could not be saved.", 503);
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await readJsonObject(request);
    if (typeof body.id !== "string" || !UUID_PATTERN.test(body.id)) {
      throw new PublicRequestError("A valid trend note ID is required.", 400);
    }
    const { supabase, user } = await requireContext();
    const { data, error } = await supabase
      .from("brand_trend_notes")
      .delete()
      .eq("id", body.id)
      .eq("created_by", user.id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new PublicRequestError("Trend note not found in this workspace.", 404);
    return NextResponse.json({ status: "success", deleted_id: data.id });
  } catch (error) {
    console.error("[BFF TrendNotes] Failed to delete note:", error instanceof Error ? error.name : "unknown");
    return publicErrorResponse(error, "Trend note could not be deleted.", 503);
  }
}
