import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = createClient();
    const { data: dbModels, error } = await supabase
      .from("models")
      .select(`
        id,
        niche,
        model_type,
        version,
        accuracy,
        created_at,
        brand_id,
        brands (
          name
        )
      `)
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    if (!dbModels || dbModels.length === 0) {
      return NextResponse.json([]);
    }

    // Map database models to match the frontend MlModel schema
    // Keep only the latest model version for each brand/niche to avoid duplicates in the UI list
    const seen = new Set<string>();
    const uniqueModels: any[] = [];

    for (const m of dbModels) {
      const key = m.model_type === "account" ? m.brand_id : m.niche;
      if (!key || seen.has(key)) continue;
      seen.add(key);

      const baselineAcc = m.accuracy ? parseFloat(m.accuracy) * 100 : 0;
      const trainedDate = new Date(m.created_at);
      const hoursAgo = Math.round((Date.now() - trainedDate.getTime()) / 3600000);
      const trainedText = hoursAgo < 24 ? `${hoursAgo} hours ago` : `${Math.round(hoursAgo / 24)} days ago`;

      uniqueModels.push({
        id: m.id,
        name: m.model_type === "account"
          ? `Personal Model: ${(Array.isArray(m.brands) ? m.brands[0]?.name : (m.brands as any)?.name) || "Unknown Brand"}`
          : `Niche Model: ${m.niche || "General"}`,
        scope: m.model_type === "account" ? "Personal" : "Niche",
        niche: m.niche || "—",
        brandId: m.brand_id || undefined,
        version: `v${m.version || "1.0.0"}`,
        // Accuracy recorded at training time. Rolling/live-drift telemetry is not
        // captured yet, so we do not synthesize a rolling series.
        baselineAccuracy: baselineAcc,
        is_active: true,
        trained: trainedText,
      });
    }

    return NextResponse.json(uniqueModels);
  } catch (error: any) {
    console.error("[BFF Models] Failed to fetch models:", error);
    return NextResponse.json(
      { status: "error", message: error.message || "Failed to fetch models" },
      { status: 500 }
    );
  }
}
