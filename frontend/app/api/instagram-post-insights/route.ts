import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRequestUser } from "@/lib/authz";

export const dynamic = "force-dynamic";

const FASTAPI_URL = process.env.FASTAPI_URL || "http://127.0.0.1:8000";
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MEDIA_ID_PATTERN = /^[0-9]{1,64}$/;
const METRIC_KEYS = new Set([
  "reach", "impressions", "views", "saved", "shares",
  "accounts_engaged", "total_interactions",
]);
const TIERS = new Set(["High", "Average", "Low"]);
const PREDICTION_MATCH_STATUSES = new Set([
  "not_found",
  "unique_verified_caption",
  "ambiguous_duplicate_caption",
]);

function finiteNumber(value: unknown, maximum = Number.POSITIVE_INFINITY): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maximum
    ? value
    : null;
}

function stringArray(value: unknown, allowed: Set<string>): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && allowed.has(item));
}

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { status: "error", message: "Request body must be valid JSON." },
        { status: 400 }
      );
    }
    const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const brand_id = record.brand_id;
    const media_id = record.media_id;
    if (
      typeof brand_id !== "string" || !UUID_PATTERN.test(brand_id) ||
      typeof media_id !== "string" || !MEDIA_ID_PATTERN.test(media_id)
    ) {
      return NextResponse.json(
        { status: "error", message: "A valid brand ID and Instagram media ID are required." },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const user = await getRequestUser(supabase);
    if (!user) return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
    const { data: ownedBrand, error: brandError } = await supabase
      .from("brands")
      .select("id")
      .eq("id", brand_id)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (brandError) {
      console.error("[BFF InstagramPostInsights] Workspace lookup failed:", brandError.code);
      return NextResponse.json(
        { status: "error", message: "The workspace database is temporarily unavailable." },
        { status: 503 }
      );
    }
    if (!ownedBrand) {
      return NextResponse.json(
        { status: "error", message: "Brand not found in this workspace." },
        { status: 404 }
      );
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (INTERNAL_API_TOKEN) headers["X-Internal-Token"] = INTERNAL_API_TOKEN;
    let response: Response;
    try {
      response = await fetch(`${FASTAPI_URL}/instagram/post-insights`, {
        method: "POST",
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(35_000),
        body: JSON.stringify({
          brand_id: ownedBrand.id,
          media_id,
          created_by: user.id,
        }),
      });
    } catch (networkError: unknown) {
      console.error(
        "[BFF InstagramPostInsights] FastAPI service is unreachable:",
        networkError instanceof Error ? networkError.message : "unknown network error"
      );
      return NextResponse.json(
        { status: "error", message: "Detailed post metrics service is unreachable." },
        { status: 503 }
      );
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const status = response.status === 401 ? 503 : response.status;
      return NextResponse.json(
        {
          status: "error",
          message: response.status === 401
            ? "Detailed post metrics service is unavailable."
            : (typeof data?.detail === "string" ? data.detail : "Post metrics are unavailable."),
        },
        { status }
      );
    }

    const rawMetrics = data?.metrics && typeof data.metrics === "object"
      ? data.metrics as Record<string, unknown>
      : {};
    const metrics = Object.fromEntries(
      Object.entries(rawMetrics).flatMap(([key, value]) => {
        const numericValue = finiteNumber(value);
        return METRIC_KEYS.has(key) && numericValue !== null ? [[key, numericValue]] : [];
      })
    );
    const rawPrediction = data?.prediction && typeof data.prediction === "object"
      ? data.prediction as Record<string, unknown>
      : null;
    const predictionTier = rawPrediction && typeof rawPrediction.tier === "string" && TIERS.has(rawPrediction.tier)
      ? rawPrediction.tier
      : null;
    const actualTier = rawPrediction && typeof rawPrediction.actual_tier === "string" && TIERS.has(rawPrediction.actual_tier)
      ? rawPrediction.actual_tier
      : null;
    const prediction = rawPrediction && predictionTier ? {
      tier: predictionTier,
      actual_tier: actualTier,
      confidence: finiteNumber(rawPrediction.confidence, 100),
      model_version: typeof rawPrediction.model_version === "string" ? rawPrediction.model_version : null,
      match_method: rawPrediction.match_method === "verified_graph_caption"
        ? "verified_graph_caption"
        : null,
    } : null;

    const result = NextResponse.json({
      status: "success",
      metrics,
      unavailable_metrics: stringArray(data?.unavailable_metrics, METRIC_KEYS),
      not_attributable_metrics: stringArray(
        data?.not_attributable_metrics,
        new Set(["profile_visits", "follows"])
      ),
      historical: {
        brand_median_er: finiteNumber(data?.historical?.brand_median_er),
        recent_median_er: finiteNumber(data?.historical?.recent_median_er),
      },
      prediction,
      prediction_match_status: typeof data?.prediction_match_status === "string" && PREDICTION_MATCH_STATUSES.has(data.prediction_match_status)
        ? data.prediction_match_status
        : "not_found",
      provenance: {
        live_source: data?.provenance?.live_source === "instagram_graph_api"
          ? "instagram_graph_api"
          : null,
        historical_source: data?.provenance?.historical_source === "production_database_instagram_graph_sync"
          ? "production_database_instagram_graph_sync"
          : null,
        prediction_source: data?.provenance?.prediction_source === "authenticated_user_prediction_history"
          ? "authenticated_user_prediction_history"
          : null,
        fetched_at: typeof data?.provenance?.fetched_at === "string"
          ? data.provenance.fetched_at
          : null,
      },
    });
    result.headers.set("Cache-Control", "private, no-store");
    return result;
  } catch (error: unknown) {
    console.error(
      "[BFF InstagramPostInsights] Fatal error:",
      error instanceof Error ? error.message : "unknown error"
    );
    return NextResponse.json(
      { status: "error", message: "Failed to load post metrics." },
      { status: 500 }
    );
  }
}
