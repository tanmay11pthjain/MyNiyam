import { z } from "zod";
import { fail, ok } from "@/server/http";
import { sanghRoute } from "@/server/admin/http";
import { removeFamily } from "@/server/admin/members";

// DELETE /api/admin/families/:accountId → { ok }
// Removes everyone on that number and frees the number to join another sangh. Their logs are
// hidden for 30 days, then deleted by private.sweep().
export const DELETE = sanghRoute<{ id: string }>("admin.families.remove", async (_req, ctx, { id }) => {
  if (!z.uuid().safeParse(id).success) return fail(ctx, { error: "not_found" });
  return (await removeFamily(ctx.admin.phone, id)) ? ok(ctx, { ok: true }) : fail(ctx, { error: "not_found" });
});
