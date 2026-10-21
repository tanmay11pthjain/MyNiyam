import { z } from "zod";
import { fail, ok, readJson } from "@/server/http";
import { sanghRoute } from "@/server/admin/http";
import { changeClass, memberDetail, removeProfile } from "@/server/admin/members";
import type { MemberDetail } from "@/lib/admin-types";

// GET    /api/admin/members/:id            → MemberDetail (full number shown here only)
// PATCH  /api/admin/members/:id { classId } → MemberDetail
// DELETE /api/admin/members/:id            → { ok }  removes this one person; the family stays

export const GET = sanghRoute<{ id: string }>("admin.members.get", async (_req, ctx, { id }) => {
  if (!z.uuid().safeParse(id).success) return fail(ctx, { error: "not_found" });
  const m = await memberDetail(ctx.admin.phone, ctx.sanghId, id);
  return m ? ok<MemberDetail>(ctx, m) : fail(ctx, { error: "not_found" });
});

const body = z.object({ classId: z.uuid() });

export const PATCH = sanghRoute<{ id: string }>("admin.members.class", async (req, ctx, { id }) => {
  if (!z.uuid().safeParse(id).success) return fail(ctx, { error: "not_found" });
  const input = await readJson(req, body);
  if (!input) return fail(ctx, { error: "bad_request" });
  const r = await changeClass(ctx.admin.phone, ctx.sanghId, id, input.classId);
  if (r !== "ok") return fail(ctx, { error: r });
  return ok<MemberDetail>(ctx, (await memberDetail(ctx.admin.phone, ctx.sanghId, id))!);
});

export const DELETE = sanghRoute<{ id: string }>("admin.members.remove", async (_req, ctx, { id }) => {
  if (!z.uuid().safeParse(id).success) return fail(ctx, { error: "not_found" });
  return (await removeProfile(ctx.admin.phone, id)) ? ok(ctx, { ok: true }) : fail(ctx, { error: "not_found" });
});
