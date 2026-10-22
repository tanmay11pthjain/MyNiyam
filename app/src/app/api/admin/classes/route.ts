import { z } from "zod";
import { fail, ok, readJson } from "@/server/http";
import { sanghRouteFor } from "@/server/admin/http";
import { classBody, classReply, createClass, listClasses, reorderClasses } from "@/server/admin/classes";

// GET  /api/admin/classes                                   → { classes: AdminClass[] }
// POST /api/admin/classes { name, nameHi, ageMin, ageMax }  → { classes } | 400 duplicate_key
// PUT  /api/admin/classes { ids: [...] }  (new order)       → { classes }

export const GET = sanghRouteFor("setup")("admin.classes.list", async (_req, ctx) =>
  ok(ctx, { classes: await listClasses(ctx.admin.phone, ctx.sanghId) }));

export const POST = sanghRouteFor("setup")("admin.classes.create", async (req, ctx) => {
  const input = await readJson(req, classBody);
  if (!input) return fail(ctx, { error: "bad_request" });
  return classReply(ctx, await createClass(ctx.admin.phone, ctx.sanghId, input));
});

const order = z.object({ ids: z.array(z.uuid()).max(100) });

export const PUT = sanghRouteFor("setup")("admin.classes.order", async (req, ctx) => {
  const input = await readJson(req, order);
  if (!input) return fail(ctx, { error: "bad_request" });
  return classReply(ctx, await reorderClasses(ctx.admin.phone, ctx.sanghId, input.ids));
});
