import { z } from "zod";
import { fail, ok, readJson, route } from "@/server/http";
import { readSession } from "@/server/session";
import { getProgress, repairStreak } from "@/server/today";

const body = z.object({ missed: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

// POST /api/repair { missed } → Progress | 400 bad_request (that day can't be made up for now)
export const POST = route("repair", async (req, ctx) => {
  const s = await readSession(req);
  if (!s) return fail(ctx, { error: "unauthorized" });
  if (!s.profileId) return fail(ctx, { error: "not_found" });
  const input = await readJson(req, body);
  if (!input) return fail(ctx, { error: "bad_request" });
  if ((await repairStreak(s.accountId, s.profileId, input.missed)) !== "ok") return fail(ctx, { error: "bad_request" });
  return ok(ctx, await getProgress(s.accountId, s.profileId));
});
