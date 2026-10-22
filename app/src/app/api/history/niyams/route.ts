import { fail, ok, route } from "@/server/http";
import { readSession } from "@/server/session";
import { getNiyamStats } from "@/server/today";
import type { NiyamStat } from "@/lib/today-types";

// GET /api/history/niyams → { niyams: NiyamStat[] }: streak, best run and total for each niyam.
export const GET = route("history.niyams", async (req, ctx) => {
  const s = await readSession(req);
  if (!s) return fail(ctx, { error: "unauthorized" });
  if (!s.profileId) return fail(ctx, { error: "not_found" });
  const r = await getNiyamStats(s.accountId, s.profileId);
  return r ? ok<{ niyams: NiyamStat[] }>(ctx, { niyams: r }) : fail(ctx, { error: "not_found" });
});
