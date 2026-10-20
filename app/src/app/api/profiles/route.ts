import { z } from "zod";
import { fail, ok, readJson, route } from "@/server/http";
import { createProfile } from "@/server/onboarding";
import { readSession, setSession } from "@/server/session";

const body = z.object({
  name: z.string().trim().min(1).max(60),
  relation: z.enum(["self", "child"]),
  consent: z.boolean().default(false), // required true for "child": the number's owner is the parent or guardian
});

// POST /api/profiles { name, relation, consent } → { profile }  (also makes it the active profile)
export const POST = route("profiles.create", async (req, ctx) => {
  const s = await readSession(req);
  if (!s) return fail(ctx, { error: "unauthorized" });
  const input = await readJson(req, body);
  if (!input) return fail(ctx, { error: "bad_request" });
  const r = await createProfile(s.accountId, s.phone, input);
  if (!r.ok) return fail(ctx, { error: r.reason });
  const res = ok(ctx, { profile: r.profile }, { status: 201 });
  await setSession(res, { accountId: s.accountId, profileId: r.profile.id });
  return res;
});
