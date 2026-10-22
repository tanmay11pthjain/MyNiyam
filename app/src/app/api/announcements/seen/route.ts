import { z } from "zod";
import { fail, ok, readJson, route } from "@/server/http";
import { readSession } from "@/server/session";
import { markSeen } from "@/server/today";

const body = z.object({ ids: z.array(z.uuid()).min(1).max(3) });

// POST /api/announcements/seen { ids } → { ok }   the person on this phone has seen these slides
export const POST = route("announcements.seen", async (req, ctx) => {
  const s = await readSession(req);
  if (!s) return fail(ctx, { error: "unauthorized" });
  if (!s.profileId) return fail(ctx, { error: "not_found" });
  const input = await readJson(req, body);
  if (!input) return fail(ctx, { error: "bad_request" });
  await markSeen(s.accountId, s.profileId, input.ids);
  return ok(ctx, { ok: true });
});
