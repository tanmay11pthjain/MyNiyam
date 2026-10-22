import { fail, ok, route } from "@/server/http";
import { readSession } from "@/server/session";
import { getProgress } from "@/server/today";
import type { Progress } from "@/lib/today-types";

// GET /api/progress → Progress (Tej, streak, best streak, kshama days) for the person using the app.
export const GET = route("progress", async (req, ctx) => {
  const s = await readSession(req);
  if (!s) return fail(ctx, { error: "unauthorized" });
  if (!s.profileId) return fail(ctx, { error: "not_found" });
  const r = await getProgress(s.accountId, s.profileId);
  return r ? ok<Progress>(ctx, r) : fail(ctx, { error: "not_found" });
});
