import { z } from "zod";
import { fail, ok, readJson } from "@/server/http";
import { sanghRoute } from "@/server/admin/http";
import { getVolunteers, logActivity, removeVolunteer, saveVolunteer, volunteerInput } from "@/server/admin/volunteers";
import { formatPhone, normalizeIndianPhone } from "@/lib/phone";
import type { VolunteersPage } from "@/lib/admin-types";

// Admins only.
// GET    /api/admin/volunteers                                → VolunteersPage (volunteers, classes, members, activity)
// POST   /api/admin/volunteers { phone, name, classIds, perms } → VolunteersPage   adds or changes one
// DELETE /api/admin/volunteers { phone }                      → VolunteersPage

export const GET = sanghRoute("admin.volunteers.list", async (_req, ctx) =>
  ok<VolunteersPage>(ctx, await getVolunteers(ctx.admin.phone, ctx.sanghId)));

export const POST = sanghRoute("admin.volunteers.save", async (req, ctx) => {
  const input = await readJson(req, volunteerInput);
  if (!input) return fail(ctx, { error: "bad_request" });
  const phone = normalizeIndianPhone(input.phone);
  if (!phone) return fail(ctx, { error: "invalid_phone" });
  const r = await saveVolunteer(ctx.admin.phone, ctx.sanghId, { ...input, phone });
  if (r === "is_admin") return fail(ctx, { error: "already_admin" });
  if (r === "invalid_class") return fail(ctx, { error: "invalid_class" });
  await logActivity(ctx.admin.phone, ctx.sanghId, "Saved a volunteer", `${input.name} (${formatPhone(phone)})`);
  return ok<VolunteersPage>(ctx, await getVolunteers(ctx.admin.phone, ctx.sanghId));
});

export const DELETE = sanghRoute("admin.volunteers.remove", async (req, ctx) => {
  const input = await readJson(req, z.object({ phone: z.string().max(20) }));
  const phone = input && normalizeIndianPhone(input.phone);
  if (!phone) return fail(ctx, { error: "invalid_phone" });
  if (!(await removeVolunteer(ctx.admin.phone, ctx.sanghId, phone))) return fail(ctx, { error: "not_found" });
  await logActivity(ctx.admin.phone, ctx.sanghId, "Removed a volunteer", formatPhone(phone));
  return ok<VolunteersPage>(ctx, await getVolunteers(ctx.admin.phone, ctx.sanghId));
});
