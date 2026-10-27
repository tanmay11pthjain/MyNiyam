import { fail, ok, route } from "@/server/http";
import { readSession } from "@/server/session";
import { getSanghTab } from "@/server/engage";

// GET /api/sangh → SanghTabResponse: goals, the class leaderboard (if on), the milestone feed, announcements
export const GET = route("sangh.tab", async (req, ctx) => {
  const s = await readSession(req);
  if (!s) return fail(ctx, { error: "unauthorized" });
  if (!s.profileId) return fail(ctx, { error: "not_found" });
  const r = await getSanghTab(s.accountId, s.profileId);
  return r ? ok(ctx, r) : fail(ctx, { error: "not_found" });
});
