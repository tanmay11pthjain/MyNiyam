import { timingSafeEqual } from "node:crypto";
import { config } from "@/server/config";
import { fail, ok, route } from "@/server/http";
import { sendReminders } from "@/server/push";

// GET|POST /api/cron/remind with "Authorization: Bearer <CRON_SECRET>" → { sent, skipped, failed }
// Called every 15 minutes by the Supabase pg_cron job (docs/SETUP.md Part I). Sending twice is harmless.
function allowed(header: string | null): boolean {
  const secret = config().CRON_SECRET;
  if (!secret || !header) return false;
  const a = Buffer.from(header), b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

const handler = route("cron.remind", async (req, ctx) => {
  if (!allowed(req.headers.get("authorization"))) return fail(ctx, { error: "unauthorized" });
  return ok(ctx, await sendReminders());
});
export const GET = handler;
export const POST = handler;
export const maxDuration = 60;
