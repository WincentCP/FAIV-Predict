import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = createClient();
    // posts(count) returns the real number of historical posts per brand —
    // this is the "samples" figure that drives model-maturity displays.
    const { data: brands, error } = await supabase
      .from("brands")
      .select("id, name, niche, followers, model_type, created_at, posts(count)")
      .order("name", { ascending: true });

    if (error) {
      throw error;
    }

    const mapped = (brands || []).map((b: any) => {
      const postCount = Array.isArray(b.posts) ? b.posts[0]?.count ?? 0 : 0;
      const { posts: _posts, ...rest } = b;
      return { ...rest, samples: postCount };
    });

    return NextResponse.json(mapped);
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
    const { name, niche, followers } = body;

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
    const followersNum = Number(followers);
    if (followers !== undefined && (!Number.isFinite(followersNum) || followersNum < 0)) {
      return NextResponse.json(
        { status: "error", message: "'followers' must be a non-negative number." },
        { status: 400 }
      );
    }

    const supabase = createClient();
    const { data: newBrand, error } = await supabase
      .from("brands")
      .insert([
        {
          name: name.trim(),
          niche: niche.trim(),
          followers: followers !== undefined ? Math.round(followersNum) : 0,
          // New brands always start on the shared niche model; the training
          // pipeline promotes them to 'personal' once a personal model ships.
          model_type: "niche",
        },
      ])
      .select()
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json({ status: "success", brand: { ...newBrand, samples: 0 } });
  } catch (error: any) {
    console.error("[BFF Brands] Failed to create brand:", error);
    return NextResponse.json(
      { status: "error", message: error.message || "Failed to create brand" },
      { status: 500 }
    );
  }
}
