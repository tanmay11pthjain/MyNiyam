import { z } from "zod";
import { fail, ok, readJson, route } from "@/server/http";
import { adminRemoveNumber } from "@/server/onboarding";
import { readSession } from "@/server/session";
import { normalizeIndianPhone } from "@/lib/phone";

const body = z.object({ phone: z.string().max(20) });

// POST /api/admin/remove-number { phone } → { removed: true } | 403 | 404
// Removes a number (and all its profiles) from the admin's sangh, which frees it to join another.
// The database function checks the caller is an admin of that same sangh.
export const POST = route("admin.removeNumber", async (req, ctx) => {
  const s = await readSession(req);
  if (!s) return fail(ctx, { error: "unauthorized" });
  const input = await readJson(req, body);
  const phone = input && normalizeIndianPhone(input.phone);
  if (!phone) return fail(ctx, { error: "invalid_phone" });
  const r = await adminRemoveNumber(s.accountId, phone);
  if (r === "forbidden") return fail(ctx, { error: "forbidden" });
  if (r === "not_found") return fail(ctx, { error: "not_found" });
  return ok(ctx, { removed: true });
});
