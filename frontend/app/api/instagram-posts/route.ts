import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRequestUser } from "@/lib/authz";

export const dynamic = "force-dynamic";

// Proxies live Instagram post insights from the ML service: media previews,
// engagement metrics, and ER tiers graded against the brand's own history.
const FASTAPI_URL = process.env.FASTAPI_URL || "http://127.0.0.1:8000";
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MEDIA_ID_PATTERN = /^[0-9]{1,64}$/;
const MEDIA_TYPES = new Set(["IMAGE", "CAROUSEL_ALBUM", "VIDEO"]);
const MEDIA_PRODUCT_TYPES = new Set(["FEED", "REELS", "STORY", "AD", "UNKNOWN"]);
const TIERS = new Set(["High", "Average", "Low"]);
const COMPARISON_UNAVAILABLE_MESSAGES: Record<string, string> = {
  not_synced: "This post has no verified synchronized engagement rate yet.",
  immature: "This post is younger than the required seven-day maturity window.",
  unmodeled_format: "This post's media format is not supported by the prediction model.",
  incomplete_features: "This synchronized post is missing features required for a like-for-like model comparison.",
  lookup_unavailable: "Comparison eligibility could not be verified from synchronized history.",
};

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function httpsUrlOrNull(value: unknown, instagramOnly = false): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (instagramOnly && url.hostname !== "instagram.com" && !url.hostname.endsWith(".instagram.com")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const brandId = searchParams.get("brand_id");
    if (!brandId || !UUID_PATTERN.test(brandId)) {
      return NextResponse.json(
        { status: "error", message: "A valid brand ID is required." },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const user = await getRequestUser(supabase);
    if (!user) return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
    const { data: ownedBrand, error: brandError } = await supabase
      .from("brands")
      .select("id, name")
      .eq("id", brandId)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (brandError) {
      console.error("[BFF InstagramPosts] Workspace lookup failed:", brandError.code);
      return NextResponse.json(
        { status: "error", message: "The workspace database is temporarily unavailable." },
        { status: 503 }
      );
    }
    if (!ownedBrand) return NextResponse.json({ status: "error", message: "Brand not found in this workspace." }, { status: 404 });

    const backendHeaders: Record<string, string> = {};
    if (INTERNAL_API_TOKEN) {
      backendHeaders["X-Internal-Token"] = INTERNAL_API_TOKEN;
    }

    let mlResponse;
    try {
      mlResponse = await fetch(
        `${FASTAPI_URL}/instagram/posts?brand_id=${encodeURIComponent(ownedBrand.id)}`,
        {
          headers: backendHeaders,
          cache: "no-store",
          signal: AbortSignal.timeout(35_000),
        }
      );
    } catch (networkError: unknown) {
      console.error(
        "[BFF InstagramPosts] FastAPI service is unreachable:",
        networkError instanceof Error ? networkError.message : "unknown network error"
      );
      return NextResponse.json(
        { status: "error", message: "Post insights service is unreachable." },
        { status: 503 }
      );
    }

    const data = await mlResponse.json().catch(() => null);
    if (!mlResponse.ok) {
      const status = mlResponse.status === 401 ? 503 : mlResponse.status;
      return NextResponse.json(
        {
          status: "error",
          message: mlResponse.status === 401
            ? "Post insights service is unavailable."
            : (typeof data?.detail === "string" ? data.detail : "Failed to fetch post insights."),
        },
        { status }
      );
    }
    if (!data || !Array.isArray(data.posts)) {
      return NextResponse.json(
        { status: "error", message: "Post insights service returned an invalid response." },
        { status: 502 }
      );
    }

    const posts = data.posts.flatMap((post: unknown) => {
      if (!post || typeof post !== "object") return [];
      const record = post as Record<string, unknown>;
      const id = stringOrNull(record.id);
      const mediaType = stringOrNull(record.media_type);
      const timestamp = stringOrNull(record.timestamp);
      if (
        !id || !MEDIA_ID_PATTERN.test(id) ||
        !mediaType || !MEDIA_TYPES.has(mediaType) ||
        !timestamp || Number.isNaN(Date.parse(timestamp))
      ) return [];
      const tier = stringOrNull(record.tier);
      const rawProductType = stringOrNull(record.media_product_type)?.toUpperCase() || null;
      const mediaProductType = rawProductType && MEDIA_PRODUCT_TYPES.has(rawProductType)
        ? rawProductType
        : null;
      const comparisonEligible = record.comparison_eligible === true;
      const rawComparisonCode = stringOrNull(record.comparison_unavailable_code);
      const comparisonCode = comparisonEligible
        ? null
        : rawComparisonCode && COMPARISON_UNAVAILABLE_MESSAGES[rawComparisonCode]
          ? rawComparisonCode
          : "lookup_unavailable";
      return [{
        id,
        caption: typeof record.caption === "string" ? record.caption : "",
        media_type: mediaType,
        media_product_type: mediaProductType,
        media_url: httpsUrlOrNull(record.media_url),
        thumbnail_url: httpsUrlOrNull(record.thumbnail_url),
        permalink: httpsUrlOrNull(record.permalink, true),
        timestamp,
        likes: finiteNumber(record.likes),
        comments: finiteNumber(record.comments),
        er: finiteNumber(record.er),
        tier: tier && TIERS.has(tier) ? tier : null,
        comparison_eligible: comparisonEligible,
        comparison_unavailable_code: comparisonCode,
        comparison_unavailable_reason: comparisonCode
          ? COMPARISON_UNAVAILABLE_MESSAGES[comparisonCode]
          : null,
        synced_at: stringOrNull(record.synced_at),
      }];
    });

    const response = NextResponse.json({
      status: "success",
      brand_id: ownedBrand.id,
      brand: ownedBrand.name,
      followers: finiteNumber(data.followers),
      posts,
      provenance: {
        live_source: data.provenance?.live_source === "instagram_graph_api"
          ? "instagram_graph_api"
          : null,
        historical_source:
          data.provenance?.historical_source === "production_database_instagram_graph_sync" ||
          data.provenance?.synced_source === "production_database_instagram_graph_sync"
          ? "production_database_instagram_graph_sync"
          : null,
        fetched_at: stringOrNull(data.provenance?.fetched_at),
        post_limit: finiteNumber(data.provenance?.post_limit),
      },
    });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error: unknown) {
    console.error(
      "[BFF InstagramPosts] Fatal error:",
      error instanceof Error ? error.message : "unknown error"
    );
    return NextResponse.json(
      { status: "error", message: "Failed to fetch post insights." },
      { status: 500 }
    );
  }
}
