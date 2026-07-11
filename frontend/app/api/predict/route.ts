import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRequestUser } from "@/lib/authz";
import {
  publicErrorResponse,
  publicUpstreamStatus,
  readJsonObject,
  whitelistedUpstreamMessage,
} from "@/lib/http-errors";

export const dynamic = "force-dynamic";

// Private FastAPI service URL (server-side only)
const FASTAPI_URL = process.env.FASTAPI_URL || "http://127.0.0.1:8000";
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN;

const ALLOWED_FORMATS = ["Reels", "Carousel", "Single Image"];
const SAFE_PREDICTION_DETAILS = new Set([
  "Prediction could not be saved with user provenance; no result was returned.",
]);

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    const { caption, format, post_hour, brand_id, scheduled_date } = body;

    const supabase = await createClient();
    const user = await getRequestUser(supabase);
    if (!user) return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
    if (typeof brand_id !== "string" || !brand_id) {
      return NextResponse.json({ status: "error", message: "A registered brand is required." }, { status: 400 });
    }
    const { data: ownedBrand, error: brandError } = await supabase
      .from("brands")
      .select("id, niche")
      .eq("id", brand_id)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (brandError) throw brandError;
    if (!ownedBrand) {
      return NextResponse.json({ status: "error", message: "Brand not found in this workspace." }, { status: 404 });
    }

    // Input validation — reject malformed requests before they hit the model.
    if (typeof caption !== "string" || !caption.trim()) {
      return NextResponse.json(
        { status: "error", message: "'caption' is required." },
        { status: 400 }
      );
    }
    if (caption.length > 2200) {
      return NextResponse.json(
        { status: "error", message: "'caption' must be at most 2,200 characters." },
        { status: 400 }
      );
    }
    if (typeof format !== "string" || !ALLOWED_FORMATS.includes(format)) {
      return NextResponse.json(
        { status: "error", message: `'format' must be one of: ${ALLOWED_FORMATS.join(", ")}.` },
        { status: 400 }
      );
    }
    const hour = Number(post_hour);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      return NextResponse.json(
        { status: "error", message: "'post_hour' must be an integer between 0 and 23." },
        { status: 400 }
      );
    }
    if (scheduled_date !== undefined && scheduled_date !== null) {
      const value = String(scheduled_date);
      const parsed = new Date(`${value}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
        return NextResponse.json(
          { status: "error", message: "'scheduled_date' must be a real ISO date (YYYY-MM-DD)." },
          { status: 400 }
        );
      }
    }

    // Service-to-service secret: the middleware already gates this route behind
    // a Supabase session; the ML service trusts the shared internal token.
    const backendHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (INTERNAL_API_TOKEN) {
      backendHeaders["X-Internal-Token"] = INTERNAL_API_TOKEN;
    }

    let mlResponse;
    try {
      mlResponse = await fetch(`${FASTAPI_URL}/predict`, {
        method: "POST",
        headers: backendHeaders,
        body: JSON.stringify({
          caption,
          format,
          post_hour: hour,
          brand_id: brand_id || null,
          niche: ownedBrand.niche,
          scheduled_date: scheduled_date || null,
          created_by: user.id,
        }),
      });
    } catch (netErr) {
      console.error("[BFF Proxy] FastAPI service is unreachable:", netErr);
      return NextResponse.json(
        {
          status: "error",
          code: "FASTAPI_UNAVAILABLE",
          message: "Prediction service is unreachable. Please try again in a few moments.",
        },
        { status: 503 }
      );
    }

    if (!mlResponse.ok) {
      const message = await whitelistedUpstreamMessage(
        mlResponse,
        SAFE_PREDICTION_DETAILS,
        mlResponse.status === 503
          ? "Prediction is unavailable for this brand. Confirm that a trained model exists and try again."
          : "Prediction service could not process this request."
      );
      console.error(`[BFF Proxy] FastAPI returned status ${mlResponse.status}.`);
      return NextResponse.json(
        { status: "error", message },
        { status: publicUpstreamStatus(mlResponse.status) }
      );
    }

    const prediction = await mlResponse.json();

    return NextResponse.json({
      status: "success",
      predicted_class: prediction.predicted_class,
      confidence: prediction.confidence,
      probabilities: prediction.probabilities,
      prediction_id: prediction.prediction_id ?? null,
      model_metadata: prediction.model_metadata ?? null,
      out_of_range: prediction.out_of_range ?? [],
      counterfactuals: prediction.counterfactuals ?? [],
      counterfactuals_note: prediction.counterfactuals_note ?? null,
      feature_importances: prediction.feature_importances,
    });
  } catch (error) {
    console.error("[BFF Proxy] Fatal error processing prediction request:", error);
    return publicErrorResponse(error, "The prediction request could not be processed.", 500);
  }
}
