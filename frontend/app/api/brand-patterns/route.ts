import { NextResponse } from "next/server";
import { publicErrorResponse } from "@/lib/http-errors";
import {
  loadBrandPatterns,
  requireOwnedBrand,
} from "@/lib/server/brand-pattern-context";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const brandId = new URL(request.url).searchParams.get("brand_id");
    const brand = await requireOwnedBrand(brandId);
    const result = await loadBrandPatterns(brand);
    if (!result.ok) {
      return NextResponse.json(
        { status: "error", message: result.message },
        { status: result.status }
      );
    }
    const response = NextResponse.json(result.data);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error: unknown) {
    return publicErrorResponse(error, "Brand performance patterns could not be loaded.", 500);
  }
}
