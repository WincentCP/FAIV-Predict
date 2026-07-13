import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRequestUser, getOwnedBrands } from "@/lib/authz";
import {
  PublicRequestError,
  publicErrorResponse,
  readJsonObject,
} from "@/lib/http-errors";
import { realizedOutcomeFields } from "@/lib/realized-outcomes";

export const dynamic = "force-dynamic";

const VOICE_OVER = new Set(["Need", "No Need", "Done"]);
const STATUSES = new Set(["Need Shooting", "Need Design", "Need Editing", "Screening", "Ready to Post", "Posted"]);
const CONTENT_TYPES = new Set(["Reels", "Carousel", "Single Image", "Unspecified"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WRITABLE = new Set([
  "brand_id", "posting_date", "posting_time", "content_type", "content_details",
  "visual_reference", "caption", "voice_over", "pic", "status", "prediction_id",
]);

function cleanEntry(input: unknown, ownedBrandIds: Set<string>) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new PublicRequestError("Each Content Plan row must be a valid object.");
  }
  const entry = input as Record<string, unknown>;
  const postingDate = String(entry.posting_date || "");
  const parsedDate = new Date(`${postingDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(postingDate) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== postingDate) {
    throw new PublicRequestError("Posting date must be a real date in YYYY-MM-DD format.");
  }
  if (entry.brand_id !== undefined && entry.brand_id !== null && typeof entry.brand_id !== "string") {
    throw new PublicRequestError("Content Plan brand must be a valid workspace brand.");
  }
  if (typeof entry.brand_id === "string" && entry.brand_id && !ownedBrandIds.has(entry.brand_id)) {
    throw new PublicRequestError("Content Plan entry references a brand outside this workspace.");
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
  const rawPredictionId = entry.prediction_id;
  if (
    rawPredictionId !== undefined &&
    rawPredictionId !== null &&
    (typeof rawPredictionId !== "string" || !UUID_PATTERN.test(rawPredictionId))
  ) {
    throw new PublicRequestError("Linked prediction must be a valid prediction ID.");
  }
  return {
    brand_id: brandId,
    posting_date: postingDate,
    posting_time: postingTime,
    content_type: contentType,
    content_details: typeof entry.content_details === "string" ? entry.content_details.slice(0, 4000) : null,
    visual_reference: typeof entry.visual_reference === "string" ? entry.visual_reference.slice(0, 2000) : null,
    caption: typeof entry.caption === "string" ? entry.caption.slice(0, 2200) : null,
    voice_over: voiceOver,
    pic: typeof entry.pic === "string" ? entry.pic.slice(0, 255) : null,
    status,
    prediction_id: typeof rawPredictionId === "string" ? rawPredictionId : null,
  };
}

type CleanCalendarEntry = ReturnType<typeof cleanEntry>;

async function validatePredictionLinks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  rows: CleanCalendarEntry[]
) {
  const ids = Array.from(new Set(rows.flatMap((row) => row.prediction_id ? [row.prediction_id] : [])));
  if (ids.length === 0) return;
  const { data, error } = await supabase
    .from("predictions")
    .select("id, brand_id")
    .in("id", ids)
    .eq("created_by", userId)
    .is("deleted_at", null);
  if (error) throw error;
  const byId = new Map((data || []).map((prediction) => [prediction.id, prediction.brand_id]));
  for (const row of rows) {
    if (!row.prediction_id) continue;
    if (!byId.has(row.prediction_id)) {
      throw new PublicRequestError("Linked prediction was not found in this workspace.", 404);
    }
    if (!row.brand_id || byId.get(row.prediction_id) !== row.brand_id) {
      throw new PublicRequestError("Content Plan and prediction must use the same brand.", 409);
    }
  }
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const user = await getRequestUser(supabase);
    if (!user) return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });

    const planId = new URL(request.url).searchParams.get("plan_id");
    if (planId && !UUID_PATTERN.test(planId)) {
      return NextResponse.json({ status: "error", message: "A valid Content Plan ID is required." }, { status: 400 });
    }
    let query = supabase
      .from("calendar_entries")
      .select("id, brand_id, posting_date, posting_time, content_type, content_details, visual_reference, caption, voice_over, pic, status, source, prediction_id, created_at, brands(name)")
      .eq("owner_id", user.id)
      .order("posting_date", { ascending: true });
    if (planId) query = query.eq("id", planId);
    const { data, error } = await query;
    if (error) throw error;
    const entries = data || [];
    const predictionIds = Array.from(new Set(entries.flatMap((entry) => entry.prediction_id ? [entry.prediction_id] : [])));
    const { data: predictions, error: predictionError } = predictionIds.length > 0
      ? await supabase
          .from("predictions")
          .select("id, pred_class, prediction_status, time_known, model_version, actual_er, actual_source, realized_class, realized_class_basis, created_at")
          .in("id", predictionIds)
          .eq("created_by", user.id)
      : { data: [], error: null };
    if (predictionError) throw predictionError;
    const predictionById = new Map((predictions || []).map((prediction) => [prediction.id, prediction]));

    const { data: publications, error: publicationError } = predictionIds.length > 0
      ? await supabase
          .from("prediction_publications")
          .select("id, prediction_id, post_id")
          .in("prediction_id", predictionIds)
          .eq("owner_id", user.id)
      : { data: [], error: null };
    if (publicationError) throw publicationError;
    const postIds = Array.from(new Set((publications || []).map((publication) => publication.post_id)));
    const { data: posts, error: postsError } = postIds.length > 0
      ? await supabase
          .from("posts")
          .select("id, instagram_media_id, er, created_at, synced_at")
          .in("id", postIds)
      : { data: [], error: null };
    if (postsError) throw postsError;
    const postById = new Map((posts || []).map((post) => [post.id, post]));
    const publicationByPrediction = new Map(
      (publications || []).map((publication) => [publication.prediction_id, publication])
    );

    const enriched = entries.map((entry) => {
      const prediction = entry.prediction_id ? predictionById.get(entry.prediction_id) : null;
      const publication = entry.prediction_id ? publicationByPrediction.get(entry.prediction_id) : null;
      const post = publication ? postById.get(publication.post_id) : null;
      const ageDays = post?.created_at
        ? Math.max(0, Math.floor((Date.now() - new Date(post.created_at).getTime()) / 86_400_000))
        : null;
      const outcomeObserved = prediction?.actual_source === "instagram_media_id";
      const realized = prediction ? realizedOutcomeFields({
        predicted: prediction.pred_class,
        realized: prediction.realized_class,
        basis: prediction.realized_class_basis,
        actualSource: prediction.actual_source,
      }) : null;
      return {
        ...entry,
        prediction: prediction ? {
          id: prediction.id,
          tier: String(prediction.pred_class || "").toLowerCase(),
          status: prediction.prediction_status,
          time_known: prediction.time_known !== false,
          model_version: prediction.model_version || null,
          actual_er: outcomeObserved && typeof prediction.actual_er === "number"
            ? prediction.actual_er
            : null,
          realized_tier: realized?.realized_tier || null,
          realized_class_basis: realized?.realized_class_basis || null,
          tier_error: realized?.tier_error ?? null,
          verification_badge: realized?.verification_badge || null,
        } : null,
        publication: publication && post ? {
          id: publication.id,
          post_id: publication.post_id,
          media_id: post.instagram_media_id,
          observed_er: outcomeObserved && typeof prediction?.actual_er === "number"
            ? prediction.actual_er
            : null,
          realized_tier: realized?.realized_tier || null,
          realized_class_basis: realized?.realized_class_basis || null,
          tier_error: realized?.tier_error ?? null,
          verification_badge: realized?.verification_badge || null,
          post_age_days: ageDays,
          synced_at: post.synced_at || null,
          outcome_status: outcomeObserved
            ? "observed"
            : ageDays !== null && ageDays < 7
              ? "pending_maturity"
              : "awaiting_observation",
        } : null,
      };
    });
    const response = NextResponse.json(enriched);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    console.error("[BFF Calendar] Failed to load entries:", error);
    return publicErrorResponse(error, "Content Plan entries are temporarily unavailable.", 503);
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
    const cleaned = inputs.map((input) => cleanEntry(input, ownedBrandIds));
    await validatePredictionLinks(supabase, user.id, cleaned);
    const rows = cleaned.map((entry) => ({
      ...entry,
      owner_id: user.id,
      source,
    }));
    const { data, error } = await supabase.from("calendar_entries").insert(rows).select();
    if (error) throw error;
    return NextResponse.json({ status: "success", entries: data || [] });
  } catch (error) {
    console.error("[BFF Calendar] Failed to create entries:", error);
    return publicErrorResponse(error, "Content Plan entries could not be saved.", 503);
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
    await validatePredictionLinks(supabase, user.id, [cleaned]);
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
    return publicErrorResponse(error, "Content Plan entry could not be updated.", 503);
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
    return publicErrorResponse(error, "Content Plan entry could not be deleted.", 503);
  }
}
