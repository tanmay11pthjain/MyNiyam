import { z } from "zod";
import { fail, ok, readJson } from "@/server/http";
import { logActivity } from "@/server/admin/volunteers";
import { sanghRouteFor } from "@/server/admin/http";
import { niyamInput, setNiyamStatus, updateNiyam } from "@/server/admin/niyams";

// PUT   /api/admin/niyams/:id { ...niyam }                          → { niyams }
// PATCH /api/admin/niyams/:id { status: active | paused | archived } → { niyams }  (past logs are kept)

export const PUT = sanghRouteFor("niyams")<{ id: string }>("admin.niyams.update", async (req, ctx, { id }) => {
  if (!z.uuid().safeParse(id).success) return fail(ctx, { error: "not_found" });
  const input = await readJson(req, niyamInput);
  if (!input) return fail(ctx, { error: "invalid_field" });
  const niyams = await updateNiyam(ctx.admin.phone, ctx.sanghId, id, input);
  if (!niyams) return fail(ctx, { error: "not_found" });
  await logActivity(ctx.admin.phone, ctx.sanghId, "Changed a niyam", input.name);
  return ok(ctx, { niyams });
});

const status = z.object({ status: z.enum(["active", "paused", "archived"]) });

export const PATCH = sanghRouteFor("niyams")<{ id: string }>("admin.niyams.status", async (req, ctx, { id }) => {
  if (!z.uuid().safeParse(id).success) return fail(ctx, { error: "not_found" });
  const input = await readJson(req, status);
  if (!input) return fail(ctx, { error: "bad_request" });
  const niyams = await setNiyamStatus(ctx.admin.phone, ctx.sanghId, id, input.status);
  if (!niyams) return fail(ctx, { error: "not_found" });
  const word = { active: "Started a niyam again", paused: "Paused a niyam", archived: "Archived a niyam" }[input.status];
  await logActivity(ctx.admin.phone, ctx.sanghId, word, niyams.find((n) => n.id === id)?.name ?? null);
  return ok(ctx, { niyams });
});
