import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { BRANDS } from "@/lib/mock-data";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = createClient();
    const { data: brands, error } = await supabase
      .from("brands")
      .select("*")
      .order("name", { ascending: true });

    if (error) {
      throw error;
    }

    return NextResponse.json(brands || []);
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
