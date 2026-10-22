import { z } from "zod";
import { fail, ok, readJson } from "@/server/http";
import { logActivity } from "@/server/admin/volunteers";
import { sanghRouteFor } from "@/server/admin/http";
import { createNiyam, getNiyams, niyamInput, reorderNiyams } from "@/server/admin/niyams";
import type { NiyamsPage } from "@/lib/admin-types";

// GET  /api/admin/niyams                 → NiyamsPage (niyams, classes, logging window)
// POST /api/admin/niyams { ...niyam }    → { niyams }
// PUT  /api/admin/niyams { ids: [...] }  → { niyams }  (new order)

export const GET = sanghRouteFor("niyams")("admin.niyams.list", async (_req, ctx) =>
  ok<NiyamsPage>(ctx, await getNiyams(ctx.admin.phone, ctx.sanghId)));

export const POST = sanghRouteFor("niyams")("admin.niyams.create", async (req, ctx) => {
  const input = await readJson(req, niyamInput);
  if (!input) return fail(ctx, { error: "invalid_field" });
  const niyams = await createNiyam(ctx.admin.phone, ctx.sanghId, input);
  await logActivity(ctx.admin.phone, ctx.sanghId, "Added a niyam", input.name);
  return ok(ctx, { niyams }, { status: 201 });
});

const order = z.object({ ids: z.array(z.uuid()).max(200) });

export const PUT = sanghRouteFor("niyams")("admin.niyams.order", async (req, ctx) => {
  const input = await readJson(req, order);
  if (!input) return fail(ctx, { error: "bad_request" });
  const niyams = await reorderNiyams(ctx.admin.phone, ctx.sanghId, input.ids);
  return niyams ? ok(ctx, { niyams }) : fail(ctx, { error: "not_found" });
});
