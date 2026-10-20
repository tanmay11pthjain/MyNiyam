import { ok } from "@/server/http";
import { sanghRoute } from "@/server/admin/http";
import { markCodeShared } from "@/server/admin/sangh";

// POST /api/admin/sangh/shared → { ok }  The admin copied, shared or printed the code (setup checklist).
export const POST = sanghRoute("admin.sangh.shared", async (_req, ctx) => {
  await markCodeShared(ctx.admin.phone, ctx.sanghId);
  return ok(ctx, { ok: true });
});
