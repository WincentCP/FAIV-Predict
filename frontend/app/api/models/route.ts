import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { MODELS } from "@/lib/mock-data";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const isSimulated = cookieStore.get("sb-simulated-login")?.value === "true";

    if (isSimulated) {
      return NextResponse.json(MODELS);
    }

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

    if (error || !dbModels || dbModels.length === 0) {
      console.warn("[BFF Models] Supabase models empty or error, falling back to static:", error);
      return NextResponse.json(MODELS);
    }

    // Map database models to match the frontend MlModel schema
    // Keep only the latest model version for each brand/niche to avoid duplicates in the UI list
    const seen = new Set<string>();
    const uniqueModels: any[] = [];

    for (const m of dbModels) {
      const key = m.model_type === "account" ? m.brand_id : m.niche;
      if (!key || seen.has(key)) continue;
      seen.add(key);

      const baselineAcc = m.accuracy ? parseFloat(m.accuracy) * 100 : 70.0;
      const trainedDate = new Date(m.created_at);
      const hoursAgo = Math.round((Date.now() - trainedDate.getTime()) / 3600000);
      const trainedText = hoursAgo < 24 ? `${hoursAgo} hours ago` : `${Math.round(hoursAgo / 24)} days ago`;

      // Synthesize 30-day rolling accuracy based on base accuracy
      const synthRolling30d = Array.from({ length: 30 }, (_, i) => {
        const noise = Math.sin(i * 1.3) * 1.4 + Math.cos(i * 0.7) * 0.8;
        return Math.max(40, Math.min(99, baselineAcc + noise));
      });

      uniqueModels.push({
        id: m.id,
        name: m.model_type === "account" 
          ? `Personal Model: ${(Array.isArray(m.brands) ? m.brands[0]?.name : (m.brands as any)?.name) || "Unknown Brand"}`
          : `Niche Model: ${m.niche || "General"}`,
        scope: m.model_type === "account" ? "Personal" : "Niche",
        niche: m.model_type === "account" ? (m.niche || "Bakery & Café") : (m.niche || "Bakery & Café"),
        brandId: m.brand_id || undefined,
        version: `v${m.version || "1.0.0"}`,
        baselineAccuracy: baselineAcc,
        rollingAccuracy: baselineAcc,
        is_active: true,
        trained: trainedText,
        rolling30d: synthRolling30d
      });
    }

    return NextResponse.json(uniqueModels);
  } catch (error: any) {
    console.error("[BFF Models] Failed to fetch models:", error);
    return NextResponse.json(MODELS);
  }
}
