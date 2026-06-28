import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = createClient();

    // 1. Get total predictions count
    const { count: totalPredictions, error: countError } = await supabase
      .from("predictions")
      .select("*", { count: "exact", head: true });

    if (countError) throw countError;

    // 2. Get active models count
    const { count: totalModels, error: modelsError } = await supabase
      .from("models")
      .select("*", { count: "exact", head: true });

    if (modelsError) throw modelsError;

    // 3. Get recent predictions (last 5)
    const { data: recent, error: recentError } = await supabase
      .from("predictions")
      .select(`
        id,
        caption,
        pred_class,
        created_at,
        brands (
          name
        )
      `)
      .order("created_at", { ascending: false })
      .limit(5);

    if (recentError) throw recentError;

    const formattedRecent = (recent || []).map((r: any) => ({
      id: r.id,
      brand: r.brands?.name || "Unknown Brand",
      caption: r.caption || "",
      tier: r.pred_class.charAt(0).toUpperCase() + r.pred_class.slice(1).toLowerCase(),
      when: r.created_at
    }));

    return NextResponse.json({
      totalPredictions: totalPredictions || 0,
      totalModels: totalModels || 0,
      recent: formattedRecent
    });
  } catch (error: any) {
    console.error("[BFF Dashboard] Failed to fetch dashboard aggregates:", error);
    return NextResponse.json(
      { status: "error", message: error.message || "Failed to fetch dashboard data" },
      { status: 500 }
    );
  }
}
