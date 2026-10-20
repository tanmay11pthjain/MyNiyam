import { fail, ok, route } from "@/server/http";
import { getMe } from "@/server/onboarding";
import { readSession } from "@/server/session";

// GET /api/me → { phone, sangh, classes, formFields, profiles, activeProfileId } | 401
export const GET = route("me", async (req, ctx) => {
  const s = await readSession(req);
  if (!s) return fail(ctx, { error: "unauthorized" });
  return ok(ctx, await getMe(s.accountId, s.profileId));
});
