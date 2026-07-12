import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRequestUser } from "@/lib/authz";
import { publicErrorResponse, readJsonObject } from "@/lib/http-errors";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MEDIA_ID_PATTERN = /^[0-9]{1,64}$/;

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    const { prediction_id, media_id, confirmed } = body;
    if (
      typeof prediction_id !== "string" || !UUID_PATTERN.test(prediction_id) ||
      typeof media_id !== "string" || !MEDIA_ID_PATTERN.test(media_id)
    ) {
      return NextResponse.json(
        { status: "error", message: "A valid prediction ID and Instagram media ID are required." },
        { status: 400 }
      );
    }
    if (confirmed !== true) {
      return NextResponse.json(
        { status: "error", message: "Explicit confirmation is required before linking a publication." },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const user = await getRequestUser(supabase);
    if (!user) return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });

    const { data: prediction, error: predictionError } = await supabase
      .from("predictions")
      .select("id, brand_id, actual_er, actual_source")
      .eq("id", prediction_id)
      .eq("created_by", user.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (predictionError) throw predictionError;
    if (!prediction) {
      return NextResponse.json({ status: "error", message: "Prediction not found in this workspace." }, { status: 404 });
    }

    const { data: post, error: postError } = await supabase
      .from("posts")
      .select("id, brand_id, instagram_media_id, er, created_at, synced_at")
      .eq("brand_id", prediction.brand_id)
      .eq("source", "instagram_graph")
      .eq("instagram_media_id", media_id)
      .maybeSingle();
    if (postError) throw postError;
    if (!post) {
      return NextResponse.json(
        { status: "error", message: "Verified Instagram post was not found for this brand." },
        { status: 404 }
      );
    }

    const { data: existing, error: existingError } = await supabase
      .from("prediction_publications")
      .select("id, prediction_id, post_id, brand_id")
      .eq("prediction_id", prediction.id)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing && existing.post_id !== post.id) {
      return NextResponse.json(
        { status: "error", message: "This prediction is already linked to a different verified publication." },
        { status: 409 }
      );
    }

    let link = existing;
    if (!link) {
      const { data: linkedRows, error: linkError } = await supabase.rpc(
        "link_prediction_publication",
        { p_prediction_id: prediction.id, p_post_id: post.id }
      );
      if (linkError) {
        if (linkError.code === "23505") {
          return NextResponse.json(
            { status: "error", message: "This verified Instagram post is already linked to a prediction." },
            { status: 409 }
          );
        }
        throw linkError;
      }
      const linked = Array.isArray(linkedRows) ? linkedRows[0] : linkedRows;
      if (!linked) throw new Error("Publication link RPC returned no link.");
      link = {
        id: linked.publication_id,
        prediction_id: linked.prediction_id,
        post_id: linked.post_id,
        brand_id: prediction.brand_id,
      };
    }

    // The database trigger owns outcome attachment. Re-read the prediction so
    // the browser receives observed versus pending-maturity state, never a
    // client-computed tier.
    const { data: refreshed, error: refreshError } = await supabase
      .from("predictions")
      .select("actual_er, actual_source")
      .eq("id", prediction.id)
      .eq("created_by", user.id)
      .single();
    if (refreshError) throw refreshError;
    const postAgeDays = Math.max(
      0,
      Math.floor((Date.now() - new Date(post.created_at).getTime()) / 86_400_000)
    );
    const response = NextResponse.json({
      status: "success",
      already_linked: Boolean(existing),
      link: {
        id: link.id,
        prediction_id: link.prediction_id,
        post_id: link.post_id,
        media_id: post.instagram_media_id,
      },
      outcome: {
        status: refreshed.actual_source === "instagram_media_id"
          ? "observed"
          : postAgeDays < 7
            ? "pending_maturity"
            : "awaiting_verified_metrics",
        observed_er: refreshed.actual_source === "instagram_media_id" && typeof refreshed.actual_er === "number"
          ? refreshed.actual_er
          : null,
        post_age_days: postAgeDays,
        synced_at: post.synced_at || null,
      },
    });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error: unknown) {
    console.error(
      "[BFF PublicationLinks] Failed to confirm publication link:",
      error instanceof Error ? error.message : "unknown error"
    );
    return publicErrorResponse(error, "Publication link could not be saved.", 503);
  }
}
