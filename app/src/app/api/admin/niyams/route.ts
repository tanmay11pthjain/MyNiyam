import { z } from "zod";
import { fail, ok, readJson } from "@/server/http";
import { sanghRoute } from "@/server/admin/http";
import { createNiyam, getNiyams, niyamInput, reorderNiyams } from "@/server/admin/niyams";
import type { NiyamsPage } from "@/lib/admin-types";

// GET  /api/admin/niyams                 → NiyamsPage (niyams, classes, logging window)
// POST /api/admin/niyams { ...niyam }    → { niyams }
// PUT  /api/admin/niyams { ids: [...] }  → { niyams }  (new order)

export const GET = sanghRoute("admin.niyams.list", async (_req, ctx) =>
  ok<NiyamsPage>(ctx, await getNiyams(ctx.admin.phone, ctx.sanghId)));

export const POST = sanghRoute("admin.niyams.create", async (req, ctx) => {
  const input = await readJson(req, niyamInput);
  if (!input) return fail(ctx, { error: "invalid_field" });
  return ok(ctx, { niyams: await createNiyam(ctx.admin.phone, ctx.sanghId, input) }, { status: 201 });
});

const order = z.object({ ids: z.array(z.uuid()).max(200) });

export const PUT = sanghRoute("admin.niyams.order", async (req, ctx) => {
  const input = await readJson(req, order);
  if (!input) return fail(ctx, { error: "bad_request" });
  const niyams = await reorderNiyams(ctx.admin.phone, ctx.sanghId, input.ids);
  return niyams ? ok(ctx, { niyams }) : fail(ctx, { error: "not_found" });
});
