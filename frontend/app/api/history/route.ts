import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = createClient();
    
    // Fetch predictions joined with brand metadata
    const { data: predictions, error } = await supabase
      .from("predictions")
      .select(`
        id,
        title,
        caption,
        features,
        pred_class,
        created_at,
        scheduled_date,
        brands (
          name,
          niche
        )
      `)
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    // Map database properties to the schema required by the history UI
    const formatted = (predictions || []).map((p: any) => {
      const is_reels = p.features?.is_reels === 1.0;
      const is_carousel = p.features?.is_carousel === 1.0;
      const format = is_reels ? "Reels" : is_carousel ? "Carousel" : "Single Image";
      
      return {
        id: p.id,
        title: p.title || `Prediksi ${format}`,
        brand: p.brands?.name || "Unknown Brand",
        account: `@${(p.brands?.name || "brand").toLowerCase().replace(/\s+/g, "")}`,
        format,
        caption: p.caption || "",
        tier: p.pred_class.charAt(0).toUpperCase() + p.pred_class.slice(1).toLowerCase(),
        confidence: p.features?.confidence ? Math.round(p.features.confidence) : 85,
        when: p.created_at,
        scheduled_date: p.scheduled_date || null
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
    const supabase = createClient();
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

    const { error } = await supabase
      .from("predictions")
      .update(updates)
      .eq("id", id);

    if (error) {
      throw error;
    }

    return NextResponse.json({ status: "success", message: "Prediction updated successfully" });
  } catch (error: any) {
    console.error("[BFF History] Failed to update prediction:", error);
    return NextResponse.json(
      { status: "error", message: error.message || "Failed to update prediction" },
      { status: 500 }
    );
  }
}
