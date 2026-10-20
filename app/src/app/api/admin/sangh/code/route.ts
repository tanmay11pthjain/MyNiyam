import { ok } from "@/server/http";
import { sanghRoute } from "@/server/admin/http";
import { regenerateJoinCode } from "@/server/admin/sangh";

// POST /api/admin/sangh/code → { joinCode }  A new code; the old one stops working at once.
export const POST = sanghRoute("admin.sangh.code", async (_req, ctx) =>
  ok(ctx, { joinCode: await regenerateJoinCode(ctx.admin.phone, ctx.sanghId) }));
