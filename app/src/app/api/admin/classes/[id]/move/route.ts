import { z } from "zod";
import { fail, ok, readJson } from "@/server/http";
import { sanghRouteFor } from "@/server/admin/http";
import { listClasses } from "@/server/admin/classes";
import { moveClass } from "@/server/admin/member-tools";
import { logActivity, nameFor } from "@/server/admin/volunteers";

// POST /api/admin/classes/:id/move { to } → { moved, classes }: everyone in this class moves to `to`.
export const POST = sanghRouteFor("setup")<{ id: string }>("admin.classes.move", async (req, ctx, { id }) => {
  const input = await readJson(req, z.object({ to: z.uuid() }));
  if (!z.uuid().safeParse(id).success || !input) return fail(ctx, { error: "bad_request" });
  const moved = await moveClass(ctx.admin.phone, ctx.sanghId, id, input.to);
  if (moved === null) return fail(ctx, { error: "not_found" });
  const [a, b] = await Promise.all([nameFor(ctx.admin.phone, "class", id), nameFor(ctx.admin.phone, "class", input.to)]);
  await logActivity(ctx.admin.phone, ctx.sanghId, "Moved a whole class", `${a} → ${b}: ${moved} people`);
  return ok(ctx, { moved, classes: await listClasses(ctx.admin.phone, ctx.sanghId) });
});
