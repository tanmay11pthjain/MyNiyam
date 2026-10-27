import { z } from "zod";
import { fail, limitIp, ok, readJson, route } from "@/server/http";
import { readSession } from "@/server/session";
import { sendAnumodana } from "@/server/engage";

const body = z.object({ badgeId: z.number().int().positive(), msg: z.number().int().min(0).max(3).nullable() });

// POST /api/anumodana { badgeId, msg: 0-3 | null } → { ok } | 404 (not in your sangh's feed, or your own)
export const POST = route("anumodana", async (req, ctx) => {
  const s = await readSession(req);
  if (!s) return fail(ctx, { error: "unauthorized" });
  if (!s.profileId) return fail(ctx, { error: "not_found" });
  const limited = await limitIp(ctx, "anumodana", 120, 60);
  if (limited) return limited;
  const input = await readJson(req, body);
  if (!input) return fail(ctx, { error: "bad_request" });
  return (await sendAnumodana(s.accountId, s.profileId, input.badgeId, input.msg)) ? ok(ctx, { ok: true }) : fail(ctx, { error: "not_found" });
});
