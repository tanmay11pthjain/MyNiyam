import { z } from "zod";
import { fail, ok } from "@/server/http";
import { logActivity, nameFor } from "@/server/admin/volunteers";
import { sanghRouteFor } from "@/server/admin/http";
import { removeFamily } from "@/server/admin/members";

// DELETE /api/admin/families/:accountId → { ok }
// Removes everyone on that number and frees the number to join another sangh. Their logs are
// hidden for 30 days, then deleted by private.sweep().
export const DELETE = sanghRouteFor("remove_members")<{ id: string }>("admin.families.remove", async (_req, ctx, { id }) => {
  if (!z.uuid().safeParse(id).success) return fail(ctx, { error: "not_found" });
  const names = await nameFor(ctx.admin.phone, "family", id);
  if (!(await removeFamily(ctx.admin.phone, id))) return fail(ctx, { error: "not_found" });
  await logActivity(ctx.admin.phone, ctx.sanghId, "Removed a family", names);
  return ok(ctx, { ok: true });
});
