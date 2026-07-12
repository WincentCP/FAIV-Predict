import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRequestUser } from "@/lib/authz";
import { publicErrorResponse, readJsonObject } from "@/lib/http-errors";
import { NICHES } from "@/lib/niches";

export const dynamic = "force-dynamic";

interface BrandRow {
  id: string;
  name: string;
  niche: string;
  followers: number | null;
  model_type: string;
  created_at: string;
  profile_summary: string | null;
  timezone: string;
}

interface TrainingPostRow {
  brand_id: string;
  is_single_image: boolean | null;
  is_carousel: boolean | null;
  is_reels: boolean | null;
  media_product_type: string | null;
}

interface VerifiedModelRow {
  brand_id: string | null;
  niche: string | null;
  model_type: string;
}

export async function GET() {
  try {
    const supabase = await createClient();
    const user = await getRequestUser(supabase);
    if (!user) return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
    const { data: brandData, error } = await supabase
      .from("brands")
      .select("id, name, niche, followers, model_type, created_at, profile_summary, timezone")
      .eq("owner_id", user.id)
      .order("name", { ascending: true });
    if (error) throw error;

    const brands = (brandData || []) as BrandRow[];
    const brandIds = brands.map((brand) => brand.id);
    const maturityCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // One tenant-scoped query counts only verified, mature posts with the exact
    // format predicate used by training. Feed videos and unresolved legacy
    // videos remain in history but cannot inflate ModelMaturity.
    const { data: postData, error: postsError } = brandIds.length > 0
      ? await supabase
          .from("posts")
          .select("brand_id, is_single_image, is_carousel, is_reels, media_product_type")
          .in("brand_id", brandIds)
          .eq("source", "instagram_graph")
          .not("instagram_media_id", "is", null)
          .lte("created_at", maturityCutoff)
      : { data: [], error: null };
    if (postsError) throw postsError;

    const countsByBrand = new Map<string, number>();
    for (const post of (postData || []) as TrainingPostRow[]) {
      const modelEligible =
        post.is_single_image === true ||
        post.is_carousel === true ||
        (post.is_reels === true && post.media_product_type === "REELS");
      if (modelEligible) {
        countsByBrand.set(post.brand_id, (countsByBrand.get(post.brand_id) || 0) + 1);
      }
    }

    const { data: modelData, error: modelError } = brandIds.length > 0
      ? await supabase
          .from("models")
          .select("brand_id, niche, model_type")
          .contains("metrics", { data_source: "instagram_graph", identity_key: "instagram_media_id" })
      : { data: [], error: null };
    if (modelError) throw modelError;
    const verifiedModels = (modelData || []) as VerifiedModelRow[];
    const personalBrandIds = new Set(
      verifiedModels
        .filter((model) => model.model_type === "account" && model.brand_id)
        .map((model) => model.brand_id as string)
    );
    const cohortNiches = new Set(
      verifiedModels
        .filter((model) => model.model_type === "niche" && !model.brand_id && model.niche)
        .map((model) => model.niche as string)
    );
    const mapped = brands.map((brand) => ({
      ...brand,
      samples: countsByBrand.get(brand.id) || 0,
      model_type: personalBrandIds.has(brand.id) ? "personal" : "niche",
      active_model_scope: personalBrandIds.has(brand.id)
        ? "personal"
        : cohortNiches.has(brand.niche)
          ? "cohort"
          : "none",
    }));

    const response = NextResponse.json(mapped);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error: unknown) {
    console.error("[BFF Brands] Failed to fetch brands:", error);
    return publicErrorResponse(error, "Brand workspaces are temporarily unavailable.", 503);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    const { name, niche, profile_summary, timezone } = body;

    if (typeof name !== "string" || !name.trim() || typeof niche !== "string" || !niche.trim()) {
      return NextResponse.json(
        { status: "error", message: "Parameters 'name' and 'niche' are required." },
        { status: 400 }
      );
    }
    if (name.trim().length > 255 || niche.trim().length > 255) {
      return NextResponse.json(
        { status: "error", message: "'name' and 'niche' must be at most 255 characters." },
        { status: 400 }
      );
    }
    if (!(NICHES as readonly string[]).includes(niche.trim())) {
      return NextResponse.json(
        { status: "error", message: "Select a supported industry niche." },
        { status: 400 }
      );
    }
    if (
      profile_summary !== undefined &&
      (typeof profile_summary !== "string" || profile_summary.trim().length > 2000)
    ) {
      return NextResponse.json(
        { status: "error", message: "Brand profile must be text no longer than 2,000 characters." },
        { status: 400 }
      );
    }
    const resolvedTimezone = timezone === undefined ? "Asia/Jakarta" : timezone;
    if (typeof resolvedTimezone !== "string" || resolvedTimezone !== "Asia/Jakarta") {
      return NextResponse.json(
        { status: "error", message: "Only the Asia/Jakarta timezone is currently supported." },
        { status: 400 }
      );
    }
    const supabase = await createClient();
    const user = await getRequestUser(supabase);
    if (!user) return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
    const { data: duplicate, error: duplicateError } = await supabase
      .from("brands")
      .select("id")
      .eq("owner_id", user.id)
      .eq("name", name.trim())
      .limit(1)
      .maybeSingle();
    if (duplicateError) throw duplicateError;
    if (duplicate) {
      return NextResponse.json(
        { status: "error", message: "A brand workspace with this name already exists." },
        { status: 409 }
      );
    }
    const { data: newBrand, error } = await supabase
      .from("brands")
      .insert([{
        name: name.trim(),
        owner_id: user.id,
        niche: niche.trim(),
        profile_summary: typeof profile_summary === "string" && profile_summary.trim()
          ? profile_summary.trim()
          : null,
        timezone: resolvedTimezone,
      }])
      .select()
      .single();
    if (error) throw error;

    return NextResponse.json({
      status: "success",
      brand: { ...newBrand, samples: 0, active_model_scope: "none" },
    });
  } catch (error: unknown) {
    console.error("[BFF Brands] Failed to create brand:", error);
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "23505"
    ) {
      return NextResponse.json(
        { status: "error", message: "A brand workspace with this name already exists." },
        { status: 409 }
      );
    }
    return publicErrorResponse(error, "Brand workspace could not be created.", 503);
  }
}
