import { NextResponse, type NextRequest } from "next/server";
import { config } from "@/server/config";
import { sql } from "@/server/db";
import { LATEST_MIGRATION } from "@/server/schema";

// GET /healthz → 200 { ok: true, db: "up", ... } or 503. Used by the host and the post-deploy check.
// It also says which outside services are switched on (never their keys), so a missing setting shows.
export async function GET(req: NextRequest) {
  void req.headers; // reading the request keeps this route dynamic
  const started = performance.now();
  try {
    await sql()`select 1`;
    const c = config();
    const [m] = await sql()`select max(name) as name from public.schema_migrations`.catch(() => [{ name: null }]);
    return NextResponse.json({
      ok: true, db: "up", dbMs: Math.round(performance.now() - started),
      otp: c.OTP_DELIVERY === "simulate" ? "simulated (1234)" : c.smsEnabled ? "sms" : "MISSING MSG91 keys",
      storage: c.supabaseStorage ? "supabase" : c.NODE_ENV === "production" ? "MISSING SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (photo uploads fail)" : "local only",
      reminders: c.pushEnabled ? (c.CRON_SECRET ? "on" : "MISSING CRON_SECRET") : "off",
      errorAlerts: c.SENTRY_DSN ? "on" : "off",
      // "BEHIND" means the code is newer than the database: run `npm run db:migrate` against it.
      schema: m?.name === LATEST_MIGRATION ? "up to date" : `BEHIND: database has ${m?.name ?? "nothing"}, app needs ${LATEST_MIGRATION}`,
    }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, db: "down" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
