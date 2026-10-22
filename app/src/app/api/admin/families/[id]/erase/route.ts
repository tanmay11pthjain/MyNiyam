import { z } from "zod";
import { fail, ok } from "@/server/http";
import { logActivity, nameFor } from "@/server/admin/volunteers";
import { sanghRoute } from "@/server/admin/http";
import { adminEraseFamily } from "@/server/privacy";

// POST /api/admin/families/:accountId/erase → { ok }
// Deletes the family, its people and all their logs now, when the family asks (no 30-day wait).
export const POST = sanghRoute<{ id: string }>("admin.families.erase", async (_req, ctx, { id }) => {
  if (!z.uuid().safeParse(id).success) return fail(ctx, { error: "not_found" });
  const names = await nameFor(ctx.admin.phone, "family", id);
  if (!(await adminEraseFamily(ctx.admin.phone, ctx.sanghId, id))) return fail(ctx, { error: "not_found" });
  await logActivity(ctx.admin.phone, ctx.sanghId, "Deleted a family's data", names);
  return ok(ctx, { ok: true });
});
