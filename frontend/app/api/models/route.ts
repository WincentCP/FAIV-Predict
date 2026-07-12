import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRequestUser, getOwnedBrands } from "@/lib/authz";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = await createClient();
    const user = await getRequestUser(supabase);
    if (!user) return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
    const ownedBrands = await getOwnedBrands(supabase, user.id);
    if (ownedBrands.length === 0) return NextResponse.json([]);
    const ownedIds = ownedBrands.map((brand) => brand.id);
    const ownedNiches = Array.from(new Set(ownedBrands.map((brand) => brand.niche).filter(Boolean)));
    const selection = `
        id,
        niche,
        model_type,
        version,
        accuracy,
        metrics,
        created_at,
        brand_id,
        brands (
          name
        )
      `;
    const personalModels = supabase
      .from("models")
      .select(selection)
      .eq("model_type", "account")
      .in("brand_id", ownedIds)
      .contains("metrics", { data_source: "instagram_graph", identity_key: "instagram_media_id" })
      .order("created_at", { ascending: false });
    const cohortModels = ownedNiches.length > 0
      ? supabase
          .from("models")
          .select(selection)
          .eq("model_type", "niche")
          .is("brand_id", null)
          .in("niche", ownedNiches)
          .contains("metrics", { data_source: "instagram_graph", identity_key: "instagram_media_id" })
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null });
    const [personalResult, cohortResult] = await Promise.all([personalModels, cohortModels]);
    const error = personalResult.error || cohortResult.error;
    const dbModels = [...(personalResult.data || []), ...(cohortResult.data || [])]
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

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

      const baselineAcc = m.accuracy !== null && m.accuracy !== undefined
        ? parseFloat(m.accuracy) * 100
        : null;
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
        evaluationStatus:
          m.metrics?.evaluation_status === "validated" || m.metrics?.evaluation_status === "exploratory"
            ? m.metrics.evaluation_status
            : null,
        macroF1: typeof m.metrics?.candidate?.macro?.f1_score === "number"
          ? m.metrics.candidate.macro.f1_score * 100
          : null,
        balancedAccuracy: typeof m.metrics?.candidate?.balanced_accuracy === "number"
          ? m.metrics.candidate.balanced_accuracy * 100
          : null,
        majorityBaselineAccuracy: typeof m.metrics?.baseline?.accuracy === "number"
          ? m.metrics.baseline.accuracy * 100
          : null,
        accuracyGain: typeof m.metrics?.accuracy_gain_over_baseline === "number"
          ? m.metrics.accuracy_gain_over_baseline * 100
          : null,
        holdoutSamples: typeof m.metrics?.test_samples === "number"
          ? m.metrics.test_samples
          : null,
        trained: trainedText,
      });
    }

    return NextResponse.json(uniqueModels);
  } catch (error: any) {
    console.error("[BFF Models] Failed to fetch models:", error);
    return NextResponse.json(
      { status: "error", message: "Model registry is temporarily unavailable." },
      { status: 500 }
    );
  }
}
