import { z } from "zod";
import { fail, ok, readJson } from "@/server/http";
import { sanghRouteFor } from "@/server/admin/http";
import { copyClassNiyams } from "@/server/admin/niyams";
import { logActivity, nameFor } from "@/server/admin/volunteers";
import type { Niyam } from "@/lib/admin-types";

// POST /api/admin/niyams/copy { from, to } → { added, niyams }: class `to` gets every niyam class `from` has.
export const POST = sanghRouteFor("niyams")("admin.niyams.copy", async (req, ctx) => {
  const input = await readJson(req, z.object({ from: z.uuid(), to: z.uuid() }));
  if (!input) return fail(ctx, { error: "bad_request" });
  const r = await copyClassNiyams(ctx.admin.phone, ctx.sanghId, input.from, input.to);
  if (!r) return fail(ctx, { error: "not_found" });
  const [a, b] = await Promise.all([nameFor(ctx.admin.phone, "class", input.from), nameFor(ctx.admin.phone, "class", input.to)]);
  await logActivity(ctx.admin.phone, ctx.sanghId, "Copied niyams", `${a} to ${b}: ${r.added} added`);
  return ok<{ added: number; niyams: Niyam[] }>(ctx, r);
});
