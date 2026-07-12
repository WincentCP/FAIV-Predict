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
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_PREDICTION_DETAILS = new Set([
  "Prediction could not be saved with user provenance; no result was returned.",
]);

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    const { caption, format, post_hour, brand_id, scheduled_date, supersedes_prediction_id } = body;

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
    const timeKnown = post_hour !== undefined && post_hour !== null;
    const hour = timeKnown ? post_hour : null;
    if (timeKnown && (
      typeof hour !== "number" ||
      !Number.isInteger(hour) ||
      hour < 0 ||
      hour > 23
    )) {
      return NextResponse.json(
        { status: "error", message: "'post_hour' must be null or an integer between 0 and 23." },
        { status: 400 }
      );
    }
    if (typeof scheduled_date !== "string") {
      return NextResponse.json(
        { status: "error", message: "'scheduled_date' is required." },
        { status: 400 }
      );
    }
    {
      const value = scheduled_date;
      const parsed = new Date(`${value}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
        return NextResponse.json(
          { status: "error", message: "'scheduled_date' must be a real ISO date (YYYY-MM-DD)." },
          { status: 400 }
        );
      }
    }

    let supersessionReason: "inputs_changed" | "time_finalized" | "manual_rerun" | null = null;
    if (supersedes_prediction_id !== undefined && supersedes_prediction_id !== null) {
      if (typeof supersedes_prediction_id !== "string" || !UUID_PATTERN.test(supersedes_prediction_id)) {
        return NextResponse.json(
          { status: "error", message: "'supersedes_prediction_id' must be a valid UUID." },
          { status: 400 }
        );
      }
      const { data: previous, error: previousError } = await supabase
        .from("predictions")
        .select("id, caption, scheduled_date, features, time_known, prediction_status")
        .eq("id", supersedes_prediction_id)
        .eq("brand_id", brand_id)
        .eq("created_by", user.id)
        .maybeSingle();
      if (previousError) throw previousError;
      if (!previous) {
        return NextResponse.json(
          { status: "error", message: "The prediction being replaced was not found in this workspace." },
          { status: 404 }
        );
      }
      if (previous.prediction_status === "superseded") {
        return NextResponse.json(
          {
            status: "error",
            message: "This prediction already has a successor. Re-evaluate the newest result instead.",
          },
          { status: 409 }
        );
      }

      const previousFeatures = previous.features as Record<string, unknown> | null;
      const previousFormat = previousFeatures?.is_reels === 1
        ? "Reels"
        : previousFeatures?.is_carousel === 1
          ? "Carousel"
          : previousFeatures?.is_single_image === 1
            ? "Single Image"
            : null;
      const previousHour = typeof previousFeatures?.post_hour === "number"
        ? previousFeatures.post_hour
        : null;
      const nonTimeInputChanged =
        previous.caption !== caption ||
        previous.scheduled_date !== scheduled_date ||
        previousFormat !== format;
      if (previous.time_known === false && timeKnown && !nonTimeInputChanged) {
        supersessionReason = "time_finalized";
      } else if (
        nonTimeInputChanged ||
        previousHour !== hour
      ) {
        supersessionReason = "inputs_changed";
      } else {
        supersessionReason = "manual_rerun";
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
          scheduled_date,
          created_by: user.id,
          supersedes_prediction_id: supersedes_prediction_id || null,
          supersession_reason: supersessionReason,
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
      prediction_context: prediction.prediction_context ?? {
        status: timeKnown ? "current" : "provisional",
        time_known: timeKnown,
        scenario_hours: [],
        scenario_support_basis: timeKnown ? "exact_time" : "unknown",
        scenario_weights: [],
        input_hash: null,
        feature_schema_version: null,
      },
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
