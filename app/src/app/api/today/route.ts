import { fail, ok, route } from "@/server/http";
import { readSession } from "@/server/session";
import { getToday } from "@/server/today";

// GET /api/today → TodayResponse for the signed-in person | 401 | 404 (no person chosen)
export const GET = route("today", async (req, ctx) => {
  const s = await readSession(req);
  if (!s) return fail(ctx, { error: "unauthorized" });
  if (!s.profileId) return fail(ctx, { error: "not_found" });
  const r = await getToday(s.accountId, s.profileId);
  return r ? ok(ctx, r) : fail(ctx, { error: "not_found" });
});
