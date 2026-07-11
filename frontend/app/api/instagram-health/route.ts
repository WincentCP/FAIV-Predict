import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRequestUser, getOwnedBrands } from "@/lib/authz";
import {
  publicErrorResponse,
  publicUpstreamStatus,
  whitelistedUpstreamMessage,
} from "@/lib/http-errors";

export const dynamic = "force-dynamic";

// Proxies the ML service's Instagram connection health check: live token
// validation per linked brand plus the last successful sync timestamp.
const FASTAPI_URL = process.env.FASTAPI_URL || "http://127.0.0.1:8000";
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN;
const SAFE_HEALTH_DETAILS = new Set([
  "brand_ids must contain valid UUIDs.",
]);
const CONNECTION_STATUSES = new Set(["connected", "error", "unreachable", "unbound"]);

function sanitizeConnection(value: unknown, ownedIds: Set<string>) {
  if (!value || typeof value !== "object") return null;
  const connection = value as Record<string, unknown>;
  if (typeof connection.brand_id !== "string" || !ownedIds.has(connection.brand_id)) return null;
  const status = typeof connection.status === "string" && CONNECTION_STATUSES.has(connection.status)
    ? connection.status
    : "unreachable";
  const sanitized: Record<string, string | number | null> = {
    brand_id: connection.brand_id,
    brand: typeof connection.brand === "string" ? connection.brand.slice(0, 255) : "Instagram connection",
    niche: typeof connection.niche === "string" ? connection.niche.slice(0, 255) : "",
    status,
    last_synced: typeof connection.last_synced === "string" ? connection.last_synced : null,
  };
  if (status === "connected") {
    if (typeof connection.username === "string") sanitized.username = connection.username.slice(0, 255);
    if (typeof connection.followers === "number" && Number.isFinite(connection.followers)) {
      sanitized.followers = Math.max(0, Math.round(connection.followers));
    }
  } else {
    sanitized.error = status === "error"
      ? "Instagram rejected this connection."
      : status === "unbound"
        ? "Instagram connection setup is incomplete."
        : "Instagram Graph API could not be reached.";
  }
  return sanitized;
}

export async function GET() {
  try {
    const supabase = await createClient();
    const user = await getRequestUser(supabase);
    if (!user) return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
    const ownedBrandIds = (await getOwnedBrands(supabase, user.id)).map((brand) => brand.id);
    const ownedIds = new Set(ownedBrandIds);
    const backendHeaders: Record<string, string> = {};
    if (INTERNAL_API_TOKEN) {
      backendHeaders["X-Internal-Token"] = INTERNAL_API_TOKEN;
    }

    let mlResponse;
    try {
      // Always send the tenant scope, including an empty value. Omitting this
      // parameter is reserved for trusted operator diagnostics in FastAPI.
      const healthUrl = `${FASTAPI_URL.replace(/\/$/, "")}/instagram/health?brand_ids=${encodeURIComponent(
        ownedBrandIds.join(",")
      )}`;
      mlResponse = await fetch(healthUrl, {
        headers: backendHeaders,
      });
    } catch (netErr) {
      console.error("[BFF InstagramHealth] FastAPI service is unreachable:", netErr);
      return NextResponse.json(
        { status: "error", message: "Connection health service is unreachable." },
        { status: 503 }
      );
    }

    if (!mlResponse.ok) {
      const message = await whitelistedUpstreamMessage(
        mlResponse,
        SAFE_HEALTH_DETAILS,
        "Connection health is temporarily unavailable."
      );
      return NextResponse.json(
        { status: "error", message },
        { status: publicUpstreamStatus(mlResponse.status) }
      );
    }

    const data = await mlResponse.json();
    if (data?.status !== "success" || !Array.isArray(data.connections)) {
      return NextResponse.json(
        { status: "error", message: "Connection health service returned an invalid response." },
        { status: 502 }
      );
    }
    return NextResponse.json({
      status: "success",
      connections: data.connections
        .map((connection: unknown) => sanitizeConnection(connection, ownedIds))
        .filter((connection: unknown) => connection !== null),
    });
  } catch (error) {
    console.error("[BFF InstagramHealth] Fatal error:", error);
    return publicErrorResponse(error, "Connection health is temporarily unavailable.", 503);
  }
}
