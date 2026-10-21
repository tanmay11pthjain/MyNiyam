import { z } from "zod";
import { fail, limitIp, ok, readJson, route } from "@/server/http";
import { readSession } from "@/server/session";
import { setLog } from "@/server/today";

const body = z.object({
  niyamId: z.uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  done: z.boolean().optional(),
  value: z.number().int().min(0).max(100000).optional(),
  choice: z.string().max(40).nullable().optional(),
});

// POST /api/log { niyamId, date, done? | value? | choice? } → { niyam } | 400 log_window_closed | 404
// One row per person, niyam and day, so a retry or a double tap never counts twice.
export const POST = route("log", async (req, ctx) => {
  const s = await readSession(req);
  if (!s) return fail(ctx, { error: "unauthorized" });
  if (!s.profileId) return fail(ctx, { error: "not_found" });
  const limited = await limitIp(ctx, "log", 300, 60);
  if (limited) return limited;
  const input = await readJson(req, body);
  if (!input || Number.isNaN(Date.parse(input.date))) return fail(ctx, { error: "bad_request" });
  const r = await setLog(s.accountId, s.profileId, input);
  if (r.ok) return ok(ctx, { niyam: r.niyam });
  return fail(ctx, { error: r.reason === "invalid_choice" ? "bad_request" : r.reason });
});
