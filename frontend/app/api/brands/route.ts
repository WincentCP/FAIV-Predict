import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

import { cookies } from "next/headers";
import { BRANDS } from "@/lib/mock-data";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const isSimulated = cookieStore.get("sb-simulated-login")?.value === "true";

    if (isSimulated) {
      const mapped = BRANDS.map(b => ({
        id: b.id,
        name: b.name,
        niche: b.niche.split(" & ")[0],
        followers: b.id === "d2850e10-2788-4833-be1b-cbbb782b68e9" ? 17416 : 1256,
        model_type: "personal"
      }));
      return NextResponse.json(mapped);
    }

    const supabase = createClient();
    const { data: brands, error } = await supabase
      .from("brands")
      .select("*")
      .order("name", { ascending: true });

    if (error || !brands || brands.length === 0) {
      console.warn("[BFF Brands] Supabase empty or error, falling back to static active brands:", error);
      const mapped = BRANDS.map(b => ({
        id: b.id,
        name: b.name,
        niche: b.niche.split(" & ")[0],
        followers: b.id === "d2850e10-2788-4833-be1b-cbbb782b68e9" ? 17416 : 1256,
        model_type: "personal"
      }));
      return NextResponse.json(mapped);
    }

    return NextResponse.json(brands);
  } catch (error: any) {
    console.error("[BFF Brands] Failed to fetch brands:", error);
    return NextResponse.json(
      { status: "error", message: error.message || "Failed to fetch brands" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, niche, followers, model_type } = body;

    if (!name || !niche) {
      return NextResponse.json(
        { status: "error", message: "Parameters 'name' and 'niche' are required." },
        { status: 400 }
      );
    }

    const supabase = createClient();
    const { data: newBrand, error } = await supabase
      .from("brands")
      .insert([
        {
          name,
          niche,
          followers: followers || 0,
          model_type: model_type || "niche"
        }
      ])
      .select()
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json({ status: "success", brand: newBrand });
  } catch (error: any) {
    console.error("[BFF Brands] Failed to create brand:", error);
    return NextResponse.json(
      { status: "error", message: error.message || "Failed to create brand" },
      { status: 500 }
    );
  }
}
