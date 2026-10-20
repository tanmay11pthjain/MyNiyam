import { z } from "zod";
import { fail, ok, readJson } from "@/server/http";
import { adminRoute } from "@/server/admin/http";
import { superApprove, superReject, superSetAdmin } from "@/server/admin/sangh";
import { normalizeIndianPhone } from "@/lib/phone";

// Super admin only.
// PATCH /api/admin/super/sanghs/:id { action: "approve" }                          → { ok }
// PATCH /api/admin/super/sanghs/:id { action: "reject" }  (pending only)           → { ok }
// PATCH /api/admin/super/sanghs/:id { action: "addAdmin" | "removeAdmin", phone }  → { ok }

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("reject") }),
  z.object({ action: z.literal("addAdmin"), phone: z.string().max(20) }),
  z.object({ action: z.literal("removeAdmin"), phone: z.string().max(20) }),
]);

export const PATCH = adminRoute<{ id: string }>("super.sanghs.update", async (req, ctx, { id }) => {
  if (!z.uuid().safeParse(id).success) return fail(ctx, { error: "not_found" });
  const input = await readJson(req, body);
  if (!input) return fail(ctx, { error: "bad_request" });
  if (input.action === "approve") return (await superApprove(ctx.admin.phone, id)) ? ok(ctx, { ok: true }) : fail(ctx, { error: "not_found" });
  if (input.action === "reject") return (await superReject(ctx.admin.phone, id)) ? ok(ctx, { ok: true }) : fail(ctx, { error: "not_found" });
  const phone = normalizeIndianPhone(input.phone);
  if (!phone) return fail(ctx, { error: "invalid_phone" });
  await superSetAdmin(ctx.admin.phone, id, phone, input.action === "addAdmin");
  return ok(ctx, { ok: true });
}, { superOnly: true });
