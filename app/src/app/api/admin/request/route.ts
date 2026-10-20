import { z } from "zod";
import { fail, ok, readJson } from "@/server/http";
import { adminRoute } from "@/server/admin/http";
import { adminMe, requestSangh } from "@/server/admin/sangh";
import { setActiveSangh } from "@/server/admin/session";
import type { AdminMe } from "@/lib/admin-types";

const body = z.object({ name: z.string().trim().min(2).max(120), city: z.string().trim().min(2).max(80) });

// POST /api/admin/request { name, city } → AdminMe   Asks for a new sangh; it waits for the super admin.
export const POST = adminRoute("admin.request", async (req, ctx) => {
  const input = await readJson(req, body);
  if (!input) return fail(ctx, { error: "bad_request" });
  const r = await requestSangh(ctx.admin.phone, input.name, input.city);
  if (!r.ok) return fail(ctx, { error: "too_many_requests", retryAfterSec: 86400 });
  await setActiveSangh(ctx.admin.sessionId, r.id);
  return ok<AdminMe>(ctx, await adminMe(ctx.admin.phone, ctx.admin.isSuper, r.id), { status: 201 });
});
