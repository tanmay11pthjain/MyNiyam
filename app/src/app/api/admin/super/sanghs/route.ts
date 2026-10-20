import { z } from "zod";
import { fail, ok, readJson } from "@/server/http";
import { adminRoute } from "@/server/admin/http";
import { superCreateSangh, superListSanghs } from "@/server/admin/sangh";
import { normalizeIndianPhone } from "@/lib/phone";
import type { SuperSangh } from "@/lib/admin-types";

// Super admin only.
// GET  /api/admin/super/sanghs                            → { sanghs: SuperSangh[] }  (requests first)
// POST /api/admin/super/sanghs { name, city, adminPhone } → { id }  (active at once)

export const GET = adminRoute("super.sanghs.list", async (_req, ctx) =>
  ok<{ sanghs: SuperSangh[] }>(ctx, { sanghs: await superListSanghs(ctx.admin.phone) }), { superOnly: true });

const create = z.object({ name: z.string().trim().min(2).max(120), city: z.string().trim().min(2).max(80), adminPhone: z.string().max(20).optional() });

export const POST = adminRoute("super.sanghs.create", async (req, ctx) => {
  const input = await readJson(req, create);
  if (!input) return fail(ctx, { error: "bad_request" });
  let admin: string | null = null;
  if (input.adminPhone?.trim()) {
    admin = normalizeIndianPhone(input.adminPhone);
    if (!admin) return fail(ctx, { error: "invalid_phone" });
  }
  const id = await superCreateSangh(ctx.admin.phone, input.name, input.city, admin);
  return ok(ctx, { id }, { status: 201 });
}, { superOnly: true });
