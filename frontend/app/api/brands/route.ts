import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRequestUser } from "@/lib/authz";
import { publicErrorResponse, readJsonObject } from "@/lib/http-errors";
import { NICHES } from "@/lib/niches";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = await createClient();
    const user = await getRequestUser(supabase);
    if (!user) return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
    const { data: brands, error } = await supabase
      .from("brands")
      .select("id, name, niche, followers, model_type, created_at")
      .eq("owner_id", user.id)
      .order("name", { ascending: true });

    if (error) {
      throw error;
    }

    // Count only posts carrying immutable Instagram media provenance. Legacy
    // rows of unknown origin remain available to administrators but never
    // inflate model-maturity claims in the product.
    const counts = await Promise.all((brands || []).map(async (brand: any) => {
      const { count, error: countError } = await supabase
        .from("posts")
        .select("id", { count: "exact", head: true })
        .eq("brand_id", brand.id)
        .eq("source", "instagram_graph")
        .not("instagram_media_id", "is", null);
      if (countError) throw countError;
      return count || 0;
    }));
    const brandIds = (brands || []).map((brand: any) => brand.id);
    const { data: verifiedModels, error: modelError } = brandIds.length > 0
      ? await supabase
          .from("models")
          .select("brand_id, niche, model_type")
          .contains("metrics", { data_source: "instagram_graph", identity_key: "instagram_media_id" })
      : { data: [], error: null };
    if (modelError) throw modelError;
    const personalBrandIds = new Set(
      (verifiedModels || [])
        .filter((model: any) => model.model_type === "account" && model.brand_id)
        .map((model: any) => model.brand_id)
    );
    const cohortNiches = new Set(
      (verifiedModels || [])
        .filter((model: any) => model.model_type === "niche" && !model.brand_id && model.niche)
        .map((model: any) => model.niche)
    );
    const mapped = (brands || []).map((brand: any, index: number) => ({
      ...brand,
      samples: counts[index],
      model_type: personalBrandIds.has(brand.id) ? "personal" : "niche",
      active_model_scope: personalBrandIds.has(brand.id)
        ? "personal"
        : cohortNiches.has(brand.niche)
          ? "cohort"
          : "none",
    }));

    return NextResponse.json(mapped);
  } catch (error) {
    console.error("[BFF Brands] Failed to fetch brands:", error);
    return publicErrorResponse(error, "Brand workspaces are temporarily unavailable.", 503);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    const { name, niche } = body;

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
        { status: "error", message: "Select a supported industry cohort." },
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
      .insert([
        {
          name: name.trim(),
          owner_id: user.id,
          niche: niche.trim(),
          // followers and model_type deliberately use database defaults.
          // Only the sync/training service may change those system fields.
        },
      ])
      .select()
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json({ status: "success", brand: { ...newBrand, samples: 0, active_model_scope: "none" } });
  } catch (error) {
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
