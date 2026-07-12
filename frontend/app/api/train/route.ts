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

const FASTAPI_URL = process.env.FASTAPI_URL || "http://127.0.0.1:8000";
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_TRAIN_STATUS_DETAILS = new Set(["Job not found"]);
const SAFE_TRAIN_START_DETAILS = new Set<string>();
const TRAIN_STATUS_TIMEOUT_MS = 20_000;
const TRAIN_START_TIMEOUT_MS = 30_000;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const job_id = searchParams.get("job_id");

    if (!job_id || !UUID_PATTERN.test(job_id)) {
      return NextResponse.json(
        { status: "error", message: "A valid retrain job ID is required." },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const user = await getRequestUser(supabase);
    if (!user) return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
    const { data: job, error: jobError } = await supabase
      .from("model_retrain_jobs")
      .select("id, brands!inner(owner_id)")
      .eq("id", job_id)
      .eq("brands.owner_id", user.id)
      .maybeSingle();
    if (jobError) throw jobError;
    if (!job) return NextResponse.json({ status: "error", message: "Retrain job not found." }, { status: 404 });

    const backendHeaders: Record<string, string> = {};
    if (INTERNAL_API_TOKEN) {
      backendHeaders["X-Internal-Token"] = INTERNAL_API_TOKEN;
    }

    const response = await fetch(`${FASTAPI_URL}/train/${job_id}`, {
      headers: backendHeaders,
      cache: "no-store",
      signal: AbortSignal.timeout(TRAIN_STATUS_TIMEOUT_MS),
    });

    if (!response.ok) {
      const message = await whitelistedUpstreamMessage(
        response,
        SAFE_TRAIN_STATUS_DETAILS,
        "Retrain status is temporarily unavailable."
      );
      return NextResponse.json(
        { status: "error", message },
        { status: publicUpstreamStatus(response.status) }
      );
    }

    const data = await response.json();
    if (!["pending", "running", "success", "failed"].includes(data?.status)) {
      return NextResponse.json(
        { status: "error", message: "Retraining service returned an invalid response." },
        { status: 502 }
      );
    }
    const status = data.status as "pending" | "running" | "success" | "failed";
    return NextResponse.json({
      status,
      created_at: typeof data?.created_at === "string" ? data.created_at : null,
      completed_at: typeof data?.completed_at === "string" ? data.completed_at : null,
      error_message: status === "failed"
        ? "Training could not be completed. Review the service logs for diagnostics."
        : null,
    });
  } catch (error) {
    console.error("[BFF Proxy] Failed to fetch retrain status:", error);
    return publicErrorResponse(error, "Retrain status is temporarily unavailable.", 503);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    const { brand_id } = body;
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
    if (!ownedBrand) return NextResponse.json({ status: "error", message: "Brand not found in this workspace." }, { status: 404 });

    const backendHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (INTERNAL_API_TOKEN) {
      backendHeaders["X-Internal-Token"] = INTERNAL_API_TOKEN;
    }

    const response = await fetch(`${FASTAPI_URL}/train`, {
      method: "POST",
      headers: backendHeaders,
      signal: AbortSignal.timeout(TRAIN_START_TIMEOUT_MS),
      body: JSON.stringify({
        brand_id: brand_id || null,
        niche: ownedBrand.niche
      }),
    });

    if (!response.ok) {
      const message = await whitelistedUpstreamMessage(
        response,
        SAFE_TRAIN_START_DETAILS,
        "Retraining could not be queued. Please try again later."
      );
      return NextResponse.json(
        { status: "error", message },
        { status: publicUpstreamStatus(response.status) }
      );
    }

    const data = await response.json();
    if (typeof data?.job_id !== "string" || !UUID_PATTERN.test(data.job_id)) {
      return NextResponse.json(
        { status: "error", message: "Retraining service returned an invalid response." },
        { status: 502 }
      );
    }
    return NextResponse.json({
      status: "pending",
      job_id: data.job_id,
      message: "Retraining job queued successfully.",
    });
  } catch (error) {
    console.error("[BFF Proxy] Failed to trigger model retraining:", error);
    return publicErrorResponse(error, "Retraining could not be queued. Please try again later.", 503);
  }
}
