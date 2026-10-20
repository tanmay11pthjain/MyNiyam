import { z } from "zod";
import { fail, ok, readJson, route } from "@/server/http";
import { setupProfile } from "@/server/onboarding";
import { readSession } from "@/server/session";

const body = z.object({
  classId: z.uuid(),
  answers: z.record(z.string().max(40), z.union([z.string().max(200), z.number(), z.null()])).default({}),
});

// PATCH /api/profiles/:id { classId, answers } → { profile } | 400 invalid_answers { fields }
export const PATCH = route<{ id: string }>("profiles.setup", async (req, ctx, { id }) => {
  const s = await readSession(req);
  if (!s) return fail(ctx, { error: "unauthorized" });
  if (!z.uuid().safeParse(id).success) return fail(ctx, { error: "not_found" });
  const input = await readJson(req, body);
  if (!input) return fail(ctx, { error: "bad_request" });
  const r = await setupProfile(s.accountId, id, input.classId, input.answers);
  if (!r.ok) return fail(ctx, r.reason === "invalid_answers" ? { error: r.reason, fields: r.fields } : { error: r.reason });
  return ok(ctx, { profile: r.profile });
});
