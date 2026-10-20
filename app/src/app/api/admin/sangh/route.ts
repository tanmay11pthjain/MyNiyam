import { z } from "zod";
import { fail, ok, readJson } from "@/server/http";
import { sanghRoute } from "@/server/admin/http";
import { getSanghProfile, updateSanghProfile } from "@/server/admin/sangh";
import { normalizeIndianPhone } from "@/lib/phone";
import type { SanghProfile } from "@/lib/admin-types";

// GET   /api/admin/sangh          → SanghProfile
// PATCH /api/admin/sangh { ... }  → SanghProfile   (any subset of the fields below)

export const GET = sanghRoute("admin.sangh.get", async (_req, ctx) => {
  const p = await getSanghProfile(ctx.admin.phone, ctx.sanghId);
  return p ? ok<SanghProfile>(ctx, p) : fail(ctx, { error: "no_sangh" });
});

const opt = (max: number) => z.string().trim().max(max).nullable().optional().transform((s) => (s === undefined ? undefined : s || null));
const patch = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  nameHi: opt(120),
  city: z.string().trim().min(2).max(80).optional(),
  area: opt(80),
  sampraday: opt(80),
  contactPhone: z.string().max(20).nullable().optional(),
  about: opt(200),
  joinOpen: z.boolean().optional(),
  searchable: z.boolean().optional(),
  logBackHours: z.union([z.literal(0), z.literal(24)]).optional(),
});

export const PATCH = sanghRoute("admin.sangh.update", async (req, ctx) => {
  const input = await readJson(req, patch);
  if (!input) return fail(ctx, { error: "bad_request" });
  let contactPhone = input.contactPhone;
  if (contactPhone) {
    const p = normalizeIndianPhone(contactPhone);
    if (!p) return fail(ctx, { error: "invalid_phone" });
    contactPhone = p;
  } else if (contactPhone === "") contactPhone = null;
  const p = await updateSanghProfile(ctx.admin.phone, ctx.sanghId, { ...input, contactPhone });
  return p ? ok<SanghProfile>(ctx, p) : fail(ctx, { error: "no_sangh" });
});
