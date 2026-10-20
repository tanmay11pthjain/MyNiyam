import { z } from "zod";
import { fail, readJson } from "@/server/http";
import { sanghRoute } from "@/server/admin/http";
import { classReply, deleteClass, updateClass } from "@/server/admin/classes";

// PATCH  /api/admin/classes/:id { name?, nameHi?, ageMin?, ageMax?, hidden? } → { classes }
// DELETE /api/admin/classes/:id → { classes } | 409 class_has_members

const patch = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  nameHi: z.string().trim().max(80).nullable().optional().transform((s) => (s === undefined ? undefined : s || null)),
  ageMin: z.number().int().min(0).max(120).nullable().optional(),
  ageMax: z.number().int().min(0).max(120).nullable().optional(),
  hidden: z.boolean().optional(),
});

export const PATCH = sanghRoute<{ id: string }>("admin.classes.update", async (req, ctx, { id }) => {
  if (!z.uuid().safeParse(id).success) return fail(ctx, { error: "not_found" });
  const input = await readJson(req, patch);
  if (!input) return fail(ctx, { error: "bad_request" });
  if (input.ageMin != null && input.ageMax != null && input.ageMin > input.ageMax) return fail(ctx, { error: "bad_request" });
  return classReply(ctx, await updateClass(ctx.admin.phone, ctx.sanghId, id, input));
});

export const DELETE = sanghRoute<{ id: string }>("admin.classes.delete", async (_req, ctx, { id }) => {
  if (!z.uuid().safeParse(id).success) return fail(ctx, { error: "not_found" });
  return classReply(ctx, await deleteClass(ctx.admin.phone, ctx.sanghId, id));
});
