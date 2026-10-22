import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import type { z } from "zod";
import { config } from "./config";
import { log } from "./log";
import { hit } from "./rate-limit";
import type { ApiError } from "@/lib/api-types";

// Helpers every route handler uses: request ids, JSON with a size cap, schema checks,
// per-IP limits and one place that turns surprises into a 500 with a request id.

export type Ctx = { requestId: string; ip: string };

const STATUS: Record<ApiError["error"], number> = {
  bad_request: 400, invalid_phone: 400, invalid_code: 400, wrong_code: 400, consent_required: 400,
  invalid_answers: 400, invalid_class: 400, code_not_found: 404, not_found: 404, not_member: 404,
  no_code: 410, code_expired: 410, other_sangh: 409, self_exists: 409, profile_limit: 409,
  unauthorized: 401, forbidden: 403, too_large: 413, too_many_requests: 429, send_failed: 502, server_error: 500,
  joins_closed: 403, class_has_members: 409, invalid_field: 400, duplicate_key: 400, no_sangh: 404, unsupported_type: 415,
  log_window_closed: 400, demo_only: 403, already_admin: 409, already_member: 409, same_number: 400,
};

export function fail(ctx: Ctx, body: ApiError): NextResponse {
  const res = NextResponse.json({ ...body, requestId: ctx.requestId }, { status: STATUS[body.error] });
  if (body.retryAfterSec) res.headers.set("retry-after", String(body.retryAfterSec));
  res.headers.set("x-request-id", ctx.requestId);
  return res;
}

export function ok<T>(ctx: Ctx, body: T, init?: ResponseInit): NextResponse {
  const res = NextResponse.json(body, init);
  res.headers.set("x-request-id", ctx.requestId);
  res.headers.set("cache-control", "no-store");
  return res;
}

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  const ip = (fwd ? fwd.split(",")[0] : req.headers.get("x-real-ip")) || "unknown";
  // Store a hash, not the address.
  return createHash("sha256").update(ip.trim()).digest("hex").slice(0, 24);
}

export class TooLarge extends Error {}

/** Parses and checks the JSON body. Returns null when it is malformed; throws TooLarge over the cap (→ 413). */
export async function readJson<S extends z.ZodType>(req: NextRequest, schema: S): Promise<z.infer<S> | null> {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > config().MAX_BODY_BYTES) throw new TooLarge();
  const text = await req.text();
  if (text.length > config().MAX_BODY_BYTES) throw new TooLarge();
  try {
    const r = schema.safeParse(JSON.parse(text));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/** Per-IP fixed-window limit. Returns a 429 response when over, else null. */
export async function limitIp(ctx: Ctx, name: string, limit: number, windowSec: number): Promise<NextResponse | null> {
  const r = await hit(`${name}:ip:${ctx.ip}`, limit, windowSec);
  return r.ok ? null : fail(ctx, { error: "too_many_requests", retryAfterSec: r.retryAfterSec });
}

/** Wraps a handler with a request id, timing log and a safe 500. */
export function route<P = unknown>(name: string, fn: (req: NextRequest, ctx: Ctx, params: P) => Promise<NextResponse>) {
  return async (req: NextRequest, segment: { params: Promise<P> }): Promise<NextResponse> => {
    const ctx: Ctx = { requestId: req.headers.get("x-request-id") || randomUUID(), ip: clientIp(req) };
    const started = performance.now();
    let res: NextResponse;
    try {
      res = await fn(req, ctx, await segment.params);
    } catch (e) {
      if (e instanceof TooLarge) return fail(ctx, { error: "too_large" });
      log.error("unhandled", { route: name, requestId: ctx.requestId, error: (e as Error).message });
      res = fail(ctx, { error: "server_error" });
    }
    log.info("request", { route: name, method: req.method, status: res.status, ms: Math.round(performance.now() - started), requestId: ctx.requestId });
    return res;
  };
}
