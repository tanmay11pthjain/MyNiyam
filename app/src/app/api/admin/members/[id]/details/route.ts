import { z } from "zod";
import { fail, ok, readJson } from "@/server/http";
import { sanghRouteFor } from "@/server/admin/http";
import { editMember, memberForm } from "@/server/admin/member-tools";
import { memberDetail } from "@/server/admin/members";
import { logActivity } from "@/server/admin/volunteers";
import type { MemberDetail } from "@/lib/admin-types";

// GET /api/admin/members/:id/details → { name, fields, answers }   for the edit sheet
// PUT /api/admin/members/:id/details { name, answers } → MemberDetail | 400 invalid_answers
const setup = sanghRouteFor("setup");

export const GET = setup<{ id: string }>("admin.members.details", async (_req, ctx, { id }) => {
  if (!z.uuid().safeParse(id).success) return fail(ctx, { error: "not_found" });
  const r = await memberForm(ctx.admin.phone, ctx.sanghId, id);
  return r ? ok(ctx, r) : fail(ctx, { error: "not_found" });
});

const body = z.object({ name: z.string().trim().min(1).max(60), answers: z.record(z.string(), z.unknown()) });

export const PUT = setup<{ id: string }>("admin.members.edit", async (req, ctx, { id }) => {
  if (!z.uuid().safeParse(id).success) return fail(ctx, { error: "not_found" });
  const input = await readJson(req, body);
  if (!input) return fail(ctx, { error: "bad_request" });
  const r = await editMember(ctx.admin.phone, ctx.sanghId, id, input.name, input.answers);
  if (!r.ok) return r.reason === "invalid_answers" ? fail(ctx, { error: "invalid_answers", fields: r.fields }) : fail(ctx, { error: "not_found" });
  await logActivity(ctx.admin.phone, ctx.sanghId, "Edited a member's details", input.name);
  return ok<MemberDetail>(ctx, (await memberDetail(ctx.admin.phone, ctx.sanghId, id))!);
});
