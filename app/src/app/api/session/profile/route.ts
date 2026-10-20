import { z } from "zod";
import { fail, ok, readJson, route } from "@/server/http";
import { profileBelongs } from "@/server/onboarding";
import { readSession, setSession } from "@/server/session";

const body = z.object({ profileId: z.uuid() });

// POST /api/session/profile { profileId } → { ok: true }  ("Who is using MyNiyam?")
export const POST = route("session.profile", async (req, ctx) => {
  const s = await readSession(req);
  if (!s) return fail(ctx, { error: "unauthorized" });
  const input = await readJson(req, body);
  if (!input) return fail(ctx, { error: "bad_request" });
  if (!(await profileBelongs(s.accountId, input.profileId))) return fail(ctx, { error: "not_found" });
  const res = ok(ctx, { ok: true });
  await setSession(res, { accountId: s.accountId, profileId: input.profileId });
  return res;
});
