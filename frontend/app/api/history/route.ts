import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRequestUser, getOwnedBrands } from "@/lib/authz";
import { publicErrorResponse, readJsonObject } from "@/lib/http-errors";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRealIsoDate(value: string) {
  const parsed = new Date(`${value}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value;
}

export async function GET() {
  try {
    const supabase = await createClient();
    const user = await getRequestUser(supabase);
    if (!user) return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
    const brandIds = (await getOwnedBrands(supabase, user.id)).map((brand) => brand.id);
    if (brandIds.length === 0) return NextResponse.json([]);

    // Fetch predictions joined with brand metadata
    const { data: predictions, error } = await supabase
      .from("predictions")
      .select(`
        id,
        title,
        caption,
        features,
        pred_class,
        actual_class,
        actual_source,
        created_at,
        scheduled_date,
        brand_id,
        brands (
          name,
          niche
        )
      `)
      .in("brand_id", brandIds)
      .eq("created_by", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    // Map database properties to the schema required by the history UI
    const formatted = (predictions || []).map((p: any) => {
      const is_reels = p.features?.is_reels === 1.0;
      const is_carousel = p.features?.is_carousel === 1.0;
      const format = is_reels ? "Reels" : is_carousel ? "Carousel" : "Single Image";
      const confidence =
        typeof p.features?.confidence === "number" ? Math.round(p.features.confidence) : null;
      const postHour =
        typeof p.features?.post_hour === "number" ? Math.round(p.features.post_hour) : null;

      return {
        id: p.id,
        title: p.title || `${format} prediction`,
        brand: p.brands?.name || "Unknown Brand",
        brand_id: p.brand_id,
        niche: p.brands?.niche || null,
        // A display name is not an Instagram username. Verified handles are
        // surfaced only by the live Graph connection health endpoint.
        account: p.brands?.name || "Unknown Brand",
        format,
        caption: p.caption || "",
        tier: p.pred_class.charAt(0).toUpperCase() + p.pred_class.slice(1).toLowerCase(),
        actual: p.actual_source === "instagram_media_id" && p.actual_class
          ? p.actual_class.charAt(0).toUpperCase() + p.actual_class.slice(1).toLowerCase()
          : null,
        confidence,
        post_hour: postHour,
        when: p.created_at,
        scheduled_date: p.scheduled_date || null,
      };
    });

    return NextResponse.json(formatted);
  } catch (error) {
    console.error("[BFF History] Failed to fetch history logs:", error);
    return publicErrorResponse(error, "Prediction history is temporarily unavailable.", 503);
  }
}

export async function PATCH(request: Request) {
  try {
    const supabase = await createClient();
    const user = await getRequestUser(supabase);
    if (!user) return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
    const brandIds = (await getOwnedBrands(supabase, user.id)).map((brand) => brand.id);
    if (brandIds.length === 0) return NextResponse.json({ status: "error", message: "Not found" }, { status: 404 });
    const { id, scheduled_date, title, caption } = await readJsonObject(request);

    if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
      return NextResponse.json(
        { status: "error", message: "A valid prediction ID is required." },
        { status: 400 }
      );
    }

    if (scheduled_date !== undefined && scheduled_date !== null &&
        (typeof scheduled_date !== "string" || !isRealIsoDate(scheduled_date))) {
      return NextResponse.json(
        { status: "error", message: "Scheduled date must be a real date in YYYY-MM-DD format." },
        { status: 400 }
      );
    }
    if (title !== undefined && (typeof title !== "string" || title.length > 255)) {
      return NextResponse.json(
        { status: "error", message: "Title must be text no longer than 255 characters." },
        { status: 400 }
      );
    }
    if (caption !== undefined && (typeof caption !== "string" || caption.length > 5000)) {
      return NextResponse.json(
        { status: "error", message: "Caption must be text no longer than 5,000 characters." },
        { status: 400 }
      );
    }
    if (scheduled_date === undefined && title === undefined && caption === undefined) {
      return NextResponse.json(
        { status: "error", message: "Provide at least one field to update." },
        { status: 400 }
      );
    }

    const updates: Record<string, string | null> = {};
    if (scheduled_date !== undefined) updates.scheduled_date = scheduled_date;
    if (title !== undefined) updates.title = title;
    if (caption !== undefined) updates.caption = caption;

    const { data: updated, error } = await supabase
      .from("predictions")
      .update(updates)
      .eq("id", id)
      .in("brand_id", brandIds)
      .eq("created_by", user.id)
      .select("id")
      .maybeSingle();

    if (error) {
      throw error;
    }
    if (!updated) return NextResponse.json({ status: "error", message: "Prediction not found" }, { status: 404 });

    return NextResponse.json({ status: "success", message: "Prediction updated successfully" });
  } catch (error) {
    console.error("[BFF History] Failed to update prediction:", error);
    return publicErrorResponse(error, "Prediction could not be updated.", 503);
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = await createClient();
    const user = await getRequestUser(supabase);
    if (!user) return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
    const brandIds = (await getOwnedBrands(supabase, user.id)).map((brand) => brand.id);
    if (brandIds.length === 0) return NextResponse.json({ status: "error", message: "Not found" }, { status: 404 });
    const { id } = await readJsonObject(request);

    if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
      return NextResponse.json(
        { status: "error", message: "A valid prediction ID is required." },
        { status: 400 }
      );
    }

    const { data: deleted, error } = await supabase
      .from("predictions")
      .delete()
      .eq("id", id)
      .in("brand_id", brandIds)
      .eq("created_by", user.id)
      .select("id")
      .maybeSingle();

    if (error) {
      throw error;
    }
    if (!deleted) return NextResponse.json({ status: "error", message: "Prediction not found" }, { status: 404 });

    return NextResponse.json({ status: "success", message: "Prediction deleted" });
  } catch (error) {
    console.error("[BFF History] Failed to delete prediction:", error);
    return publicErrorResponse(error, "Prediction could not be deleted.", 503);
  }
}
