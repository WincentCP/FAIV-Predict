import { NextResponse } from "next/server";

export class PublicRequestError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "PublicRequestError";
    this.status = status;
  }
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new PublicRequestError("Request body must be valid JSON.");
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PublicRequestError("Request body must be a JSON object.");
  }

  return value as Record<string, unknown>;
}

export function publicErrorResponse(
  error: unknown,
  fallbackMessage: string,
  fallbackStatus = 500
) {
  if (error instanceof PublicRequestError) {
    return NextResponse.json(
      { status: "error", message: error.message },
      { status: error.status }
    );
  }

  return NextResponse.json(
    { status: "error", message: fallbackMessage },
    { status: fallbackStatus }
  );
}

/**
 * Reads a structured upstream error without ever reflecting arbitrary provider
 * text. Only details explicitly owned by this application may reach browsers.
 */
export async function whitelistedUpstreamMessage(
  response: Response,
  allowedDetails: ReadonlySet<string>,
  fallbackMessage: string
): Promise<string> {
  try {
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object") return fallbackMessage;
    const detail = (payload as { detail?: unknown }).detail;
    return typeof detail === "string" && allowedDetails.has(detail)
      ? detail
      : fallbackMessage;
  } catch {
    return fallbackMessage;
  }
}

/** Internal service authentication failures are gateway failures, not user auth failures. */
export function publicUpstreamStatus(status: number): number {
  if (status === 400 || status === 404 || status === 409 || status === 422 || status === 429) {
    return status;
  }
  return status >= 500 ? 503 : 502;
}
