import { fail, ok, route } from "@/server/http";
import { readSession } from "@/server/session";
import { getBadges } from "@/server/engage";

// GET /api/badges → BadgesResponse (badges earned, sharing choices) for the chosen person
export const GET = route("badges", async (req, ctx) => {
  const s = await readSession(req);
  if (!s) return fail(ctx, { error: "unauthorized" });
  if (!s.profileId) return fail(ctx, { error: "not_found" });
  const r = await getBadges(s.accountId, s.profileId);
  return r ? ok(ctx, r) : fail(ctx, { error: "not_found" });
});
