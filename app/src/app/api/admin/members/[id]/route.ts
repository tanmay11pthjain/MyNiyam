import { z } from "zod";
import { fail, ok, readJson } from "@/server/http";
import { logActivity, nameFor } from "@/server/admin/volunteers";
import { sanghRouteFor } from "@/server/admin/http";
import { changeClass, memberDetail, removeProfile } from "@/server/admin/members";
import type { MemberDetail } from "@/lib/admin-types";

// GET    /api/admin/members/:id            → MemberDetail (full number shown here only)
// PATCH  /api/admin/members/:id { classId } → MemberDetail
// DELETE /api/admin/members/:id            → { ok }  removes this one person; the family stays

export const GET = sanghRouteFor("view_members")<{ id: string }>("admin.members.get", async (_req, ctx, { id }) => {
  if (!z.uuid().safeParse(id).success) return fail(ctx, { error: "not_found" });
  const m = await memberDetail(ctx.admin.phone, ctx.sanghId, id);
  return m ? ok<MemberDetail>(ctx, m) : fail(ctx, { error: "not_found" });
});

const body = z.object({ classId: z.uuid() });

export const PATCH = sanghRouteFor("setup")<{ id: string }>("admin.members.class", async (req, ctx, { id }) => {
  if (!z.uuid().safeParse(id).success) return fail(ctx, { error: "not_found" });
  const input = await readJson(req, body);
  if (!input) return fail(ctx, { error: "bad_request" });
  const r = await changeClass(ctx.admin.phone, ctx.sanghId, id, input.classId);
  if (r !== "ok") return fail(ctx, { error: r });
  await logActivity(ctx.admin.phone, ctx.sanghId, "Moved to another class", `${await nameFor(ctx.admin.phone, "profile", id)} → ${await nameFor(ctx.admin.phone, "class", input.classId)}`);
  return ok<MemberDetail>(ctx, (await memberDetail(ctx.admin.phone, ctx.sanghId, id))!);
});

export const DELETE = sanghRouteFor("remove_members")<{ id: string }>("admin.members.remove", async (_req, ctx, { id }) => {
  if (!z.uuid().safeParse(id).success) return fail(ctx, { error: "not_found" });
  const name = await nameFor(ctx.admin.phone, "profile", id);
  if (!(await removeProfile(ctx.admin.phone, id))) return fail(ctx, { error: "not_found" });
  await logActivity(ctx.admin.phone, ctx.sanghId, "Removed a person", name);
  return ok(ctx, { ok: true });
});
