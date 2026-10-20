import { z } from "zod";
import { config } from "@/server/config";
import { fail, limitIp, ok, readJson, route } from "@/server/http";
import { verifyOtp } from "@/server/otp";
import { adminRoute } from "@/server/admin/http";
import { adminMe, isAdminOf } from "@/server/admin/sangh";
import { clearAdminCookie, endAdminSession, readAdminSession, setActiveSangh, startAdminSession } from "@/server/admin/session";
import { normalizeIndianPhone } from "@/lib/phone";
import { OTP_PATTERN } from "@/lib/otp-code";
import type { AdminMe } from "@/lib/admin-types";

// GET    /api/admin/session                 → AdminMe | 401
// POST   /api/admin/session { phone, code } → { ok } and the admin cookie (code from POST /api/otp/send)
// PUT    /api/admin/session { sanghId }     → AdminMe (switch sangh) | 404 no_sangh
// DELETE /api/admin/session                 → { ok } (log out)

export const GET = adminRoute("admin.session.get", async (_req, ctx) => {
  let me = await adminMe(ctx.admin.phone, ctx.admin.isSuper, ctx.admin.activeSanghId);
  // No sangh open (first visit, or taken off the last one): open the first one this phone runs.
  if (!me.activeSanghId && me.sanghs.length) {
    const first = me.sanghs.find((s) => s.status === "active") ?? me.sanghs[0];
    await setActiveSangh(ctx.admin.sessionId, first.id);
    me = { ...me, activeSanghId: first.id };
  }
  return ok<AdminMe>(ctx, me);
});

const login = z.object({ phone: z.string().max(20), code: z.string().regex(OTP_PATTERN) });

export const POST = route("admin.session.login", async (req, ctx) => {
  const input = await readJson(req, login);
  if (!input) return fail(ctx, { error: "bad_request" });
  const phone = normalizeIndianPhone(input.phone);
  if (!phone) return fail(ctx, { error: "invalid_phone" });
  const limited = await limitIp(ctx, "otp_verify", config().RL_VERIFY_PER_IP_HOUR, 3600);
  if (limited) return limited;
  const v = await verifyOtp(phone, input.code);
  if (!v.ok) return fail(ctx, v.reason === "wrong_code" ? { error: "wrong_code", attemptsLeft: v.attemptsLeft } : { error: v.reason });
  const res = ok(ctx, { ok: true });
  await startAdminSession(res, phone);
  return res;
});

const pick = z.object({ sanghId: z.uuid() });

export const PUT = adminRoute("admin.session.switch", async (req, ctx) => {
  const input = await readJson(req, pick);
  if (!input) return fail(ctx, { error: "bad_request" });
  if (!(await isAdminOf(ctx.admin.phone, input.sanghId))) return fail(ctx, { error: "no_sangh" });
  await setActiveSangh(ctx.admin.sessionId, input.sanghId);
  return ok<AdminMe>(ctx, await adminMe(ctx.admin.phone, ctx.admin.isSuper, input.sanghId));
});

export const DELETE = route("admin.session.logout", async (req, ctx) => {
  const s = await readAdminSession(req);
  if (s) await endAdminSession(s.sessionId);
  const res = ok(ctx, { ok: true });
  clearAdminCookie(res);
  return res;
});
