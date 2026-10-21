import { z } from "zod";
import { fail, ok, readJson } from "@/server/http";
import { sanghRoute } from "@/server/admin/http";
import { niyamInput, setNiyamStatus, updateNiyam } from "@/server/admin/niyams";

// PUT   /api/admin/niyams/:id { ...niyam }                          → { niyams }
// PATCH /api/admin/niyams/:id { status: active | paused | archived } → { niyams }  (past logs are kept)

export const PUT = sanghRoute<{ id: string }>("admin.niyams.update", async (req, ctx, { id }) => {
  if (!z.uuid().safeParse(id).success) return fail(ctx, { error: "not_found" });
  const input = await readJson(req, niyamInput);
  if (!input) return fail(ctx, { error: "invalid_field" });
  const niyams = await updateNiyam(ctx.admin.phone, ctx.sanghId, id, input);
  return niyams ? ok(ctx, { niyams }) : fail(ctx, { error: "not_found" });
});

const status = z.object({ status: z.enum(["active", "paused", "archived"]) });

export const PATCH = sanghRoute<{ id: string }>("admin.niyams.status", async (req, ctx, { id }) => {
  if (!z.uuid().safeParse(id).success) return fail(ctx, { error: "not_found" });
  const input = await readJson(req, status);
  if (!input) return fail(ctx, { error: "bad_request" });
  const niyams = await setNiyamStatus(ctx.admin.phone, ctx.sanghId, id, input.status);
  return niyams ? ok(ctx, { niyams }) : fail(ctx, { error: "not_found" });
});
