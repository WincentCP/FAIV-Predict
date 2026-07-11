import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRequestUser, getOwnedBrands } from "@/lib/authz";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = await createClient();
    const user = await getRequestUser(supabase);
    if (!user) {
      return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
    }

    const ownedBrands = await getOwnedBrands(supabase, user.id);
    const brandIds = ownedBrands.map((brand) => brand.id);
    const ownedNiches = Array.from(new Set(ownedBrands.map((brand) => brand.niche).filter(Boolean)));
    if (brandIds.length === 0) {
      return NextResponse.json({
        totalPredictions: 0, totalModels: 0, totalBrands: 0,
        highCount: 0, avgCount: 0, lowCount: 0,
        highTierRate: "0%", avgConfidence: "—", accuracyTrend: [], recent: [],
      });
    }

    const personalModels = supabase
      .from("models")
      .select("id, accuracy, created_at, brand_id, niche, model_type, brands(name)")
      .eq("model_type", "account")
      .in("brand_id", brandIds)
      .contains("metrics", { data_source: "instagram_graph", identity_key: "instagram_media_id" });
    const cohortModels = ownedNiches.length > 0
      ? supabase
          .from("models")
          .select("id, accuracy, created_at, brand_id, niche, model_type, brands(name)")
          .eq("model_type", "niche")
          .is("brand_id", null)
          .in("niche", ownedNiches)
          .contains("metrics", { data_source: "instagram_graph", identity_key: "instagram_media_id" })
      : Promise.resolve({ data: [], error: null });

    const [totalResult, highResult, averageResult, lowResult, confidenceResult, recentResult, personalModelResult, cohortModelResult] =
      await Promise.all([
        supabase.from("predictions").select("*", { count: "exact", head: true }).in("brand_id", brandIds).eq("created_by", user.id),
        supabase.from("predictions").select("*", { count: "exact", head: true }).in("brand_id", brandIds).eq("created_by", user.id).eq("pred_class", "HIGH"),
        supabase.from("predictions").select("*", { count: "exact", head: true }).in("brand_id", brandIds).eq("created_by", user.id).eq("pred_class", "AVERAGE"),
        supabase.from("predictions").select("*", { count: "exact", head: true }).in("brand_id", brandIds).eq("created_by", user.id).eq("pred_class", "LOW"),
        supabase.from("predictions").select("features").in("brand_id", brandIds).eq("created_by", user.id).order("created_at", { ascending: false }).limit(50),
        supabase.from("predictions").select("id, caption, pred_class, created_at, features, brands(name)").in("brand_id", brandIds).eq("created_by", user.id).order("created_at", { ascending: false }).limit(5),
        personalModels,
        cohortModels,
      ]);

    const firstError = [
      totalResult.error, highResult.error, averageResult.error, lowResult.error,
      confidenceResult.error, recentResult.error, personalModelResult.error, cohortModelResult.error,
    ].find(Boolean);
    if (firstError) throw firstError;

    const total = totalResult.count || 0;
    const high = highResult.count || 0;
    const avg = averageResult.count || 0;
    const low = lowResult.count || 0;
    const confidences = (confidenceResult.data || [])
      .map((row: any) => row.features?.confidence)
      .filter((value: unknown): value is number => typeof value === "number" && Number.isFinite(value));
    const avgConfidence = confidences.length
      ? `${(confidences.reduce((sum, value) => sum + value, 0) / confidences.length).toFixed(1)}%`
      : "—";

    const relevantModels = [
      ...(personalModelResult.data || []),
      ...(cohortModelResult.data || []),
    ].sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const accuracyTrend = relevantModels.slice(0, 8).reverse()
      .filter((model: any) => Number(model.accuracy) > 0)
      .map((model: any) => {
        const date = new Date(model.created_at);
        return {
          label: `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`,
          accuracy: Number(model.accuracy) * 100,
          scope: model.model_type === "account"
            ? `Personal: ${model.brands?.name || "Owned brand"}`
            : `Cohort: ${model.niche || "Unknown"}`,
        };
      });
    const modelScopes = new Set(
      relevantModels
        .map((model: any) => model.model_type === "account" ? `account:${model.brand_id}` : `cohort:${model.niche}`)
        .filter((key: string) => !key.endsWith(":null"))
    );

    const recent = (recentResult.data || []).map((row: any) => ({
      id: row.id,
      brand: row.brands?.name || "Unknown Brand",
      caption: row.caption || "",
      tier: row.pred_class.charAt(0).toUpperCase() + row.pred_class.slice(1).toLowerCase(),
      confidence: typeof row.features?.confidence === "number" ? Math.round(row.features.confidence) : null,
      when: row.created_at,
    }));

    return NextResponse.json({
      totalPredictions: total,
      totalModels: modelScopes.size,
      totalBrands: ownedBrands.length,
      highCount: high, avgCount: avg, lowCount: low,
      highTierRate: total > 0 ? `${((high / total) * 100).toFixed(1)}%` : "0%",
      avgConfidence, accuracyTrend, recent,
    });
  } catch (error: any) {
    console.error("[BFF Dashboard] Failed to fetch dashboard aggregates:", error);
    return NextResponse.json(
      { status: "error", message: "Dashboard data is temporarily unavailable." },
      { status: 503 }
    );
  }
}
