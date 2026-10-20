import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/server/db";

// GET /healthz → 200 { ok: true, db: "up" } or 503. Used by the host and the post-deploy check.
export async function GET(req: NextRequest) {
  void req.headers; // reading the request keeps this route dynamic
  const started = performance.now();
  try {
    await sql()`select 1`;
    return NextResponse.json({ ok: true, db: "up", dbMs: Math.round(performance.now() - started) }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, db: "down" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
