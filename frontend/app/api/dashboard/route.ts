import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = createClient();

    // 1. Total predictions count
    const { count: totalPredictions } = await supabase
      .from("predictions")
      .select("*", { count: "exact", head: true });

    // 2. Total models count
    const { count: totalModels } = await supabase
      .from("models")
      .select("*", { count: "exact", head: true });

    // 2.5 Total brands count
    const { count: totalBrands } = await supabase
      .from("brands")
      .select("*", { count: "exact", head: true });

    // 3. Tier distribution — count each class separately
    const [
      { count: highCount },
      { count: avgCount },
      { count: lowCount }
    ] = await Promise.all([
      supabase.from("predictions").select("*", { count: "exact", head: true }).eq("pred_class", "HIGH"),
      supabase.from("predictions").select("*", { count: "exact", head: true }).eq("pred_class", "AVERAGE"),
      supabase.from("predictions").select("*", { count: "exact", head: true }).eq("pred_class", "LOW"),
    ]);

    const total = (totalPredictions || 0);
    const high = highCount || 0;
    const avg = avgCount || 0;
    const low = lowCount || 0;
    const highTierRate = total > 0 ? `${((high / total) * 100).toFixed(1)}%` : "0%";

    // 4. Average confidence from recent 50 predictions (reads confidence from features JSONB)
    const { data: recentForConf } = await supabase
      .from("predictions")
      .select("features")
      .order("created_at", { ascending: false })
      .limit(50);

    let avgConfidence = "—";
    if (recentForConf && recentForConf.length > 0) {
      const confs = recentForConf
        .map((r: any) => r.features?.confidence)
        .filter((c: any) => typeof c === "number" && c > 0);
      if (confs.length > 0) {
        const mean = confs.reduce((s: number, c: number) => s + c, 0) / confs.length;
        avgConfidence = `${mean.toFixed(1)}%`;
      }
    }

    // 5. Accuracy trend from recent model training records (last 14 models)
    const { data: recentModels } = await supabase
      .from("models")
      .select("accuracy, created_at")
      .order("created_at", { ascending: true })
      .limit(14);

    const accuracyTrend = (recentModels || []).map((m: any) => {
      const d = new Date(m.created_at);
      const day = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
      return {
        day,
        accuracy: m.accuracy ? parseFloat(m.accuracy) * 100 : 0
      };
    }).filter((x: any) => x.accuracy > 0);

    // 6. Recent predictions (last 5)
    const { data: recent } = await supabase
      .from("predictions")
      .select(`
        id,
        caption,
        pred_class,
        created_at,
        features,
        brands (
          name
        )
      `)
      .order("created_at", { ascending: false })
      .limit(5);

    const formattedRecent = (recent || []).map((r: any) => ({
      id: r.id,
      brand: r.brands?.name || "Unknown Brand",
      caption: r.caption || "",
      tier: r.pred_class.charAt(0).toUpperCase() + r.pred_class.slice(1).toLowerCase(),
      confidence: r.features?.confidence ? Math.round(r.features.confidence) : null,
      when: r.created_at
    }));

    return NextResponse.json({
      totalPredictions: total,
      totalModels: totalModels || 0,
      totalBrands: totalBrands || 0,
      highCount: high,
      avgCount: avg,
      lowCount: low,
      highTierRate,
      avgConfidence,
      accuracyTrend,
      recent: formattedRecent
    });
  } catch (error: any) {
    console.error("[BFF Dashboard] Failed to fetch dashboard aggregates:", error);
    return NextResponse.json({
      totalPredictions: 0,
      totalModels: 0,
      totalBrands: 0,
      highCount: 0,
      avgCount: 0,
      lowCount: 0,
      highTierRate: "0%",
      avgConfidence: "—",
      accuracyTrend: [],
      recent: []
    });
  }
}
