import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { brandHandle } from "@/lib/types";
import { getRequestUser, getOwnedBrands } from "@/lib/authz";

export const dynamic = "force-dynamic";

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
        account: brandHandle(p.brands?.name || "brand"),
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
  } catch (error: any) {
    console.error("[BFF History] Failed to fetch history logs:", error);
    return NextResponse.json(
      { status: "error", message: error.message || "Failed to fetch prediction history" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const supabase = await createClient();
    const user = await getRequestUser(supabase);
    if (!user) return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
    const brandIds = (await getOwnedBrands(supabase, user.id)).map((brand) => brand.id);
    if (brandIds.length === 0) return NextResponse.json({ status: "error", message: "Not found" }, { status: 404 });
    const { id, scheduled_date, title, caption } = await request.json();

    if (!id) {
      return NextResponse.json(
        { status: "error", message: "Prediction ID is required" },
        { status: 400 }
      );
    }

    const updates: any = {};
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
  } catch (error: any) {
    console.error("[BFF History] Failed to update prediction:", error);
    return NextResponse.json(
      { status: "error", message: error.message || "Failed to update prediction" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = await createClient();
    const user = await getRequestUser(supabase);
    if (!user) return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
    const brandIds = (await getOwnedBrands(supabase, user.id)).map((brand) => brand.id);
    if (brandIds.length === 0) return NextResponse.json({ status: "error", message: "Not found" }, { status: 404 });
    const { id } = await request.json();

    if (!id) {
      return NextResponse.json(
        { status: "error", message: "Prediction ID is required" },
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
  } catch (error: any) {
    console.error("[BFF History] Failed to delete prediction:", error);
    return NextResponse.json(
      { status: "error", message: error.message || "Failed to delete prediction" },
      { status: 500 }
    );
  }
}
