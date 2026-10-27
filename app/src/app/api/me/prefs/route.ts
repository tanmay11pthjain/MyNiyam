import { z } from "zod";
import { fail, ok, readJson, route } from "@/server/http";
import { readSession } from "@/server/session";
import { setSharePrefs } from "@/server/engage";

const body = z.object({ shareMilestones: z.boolean().optional(), boardInitials: z.boolean().optional() });

// PATCH /api/me/prefs { shareMilestones?, boardInitials? } → { ok }. For the chosen person.
export const PATCH = route("me.prefs", async (req, ctx) => {
  const s = await readSession(req);
  if (!s) return fail(ctx, { error: "unauthorized" });
  if (!s.profileId) return fail(ctx, { error: "not_found" });
  const input = await readJson(req, body);
  if (!input) return fail(ctx, { error: "bad_request" });
  return (await setSharePrefs(s.accountId, s.profileId, input)) ? ok(ctx, { ok: true }) : fail(ctx, { error: "not_found" });
});
