import { z } from "zod";
import { config } from "@/server/config";
import { sql } from "@/server/db";
import { fail, limitIp, ok, readJson } from "@/server/http";
import { sanghRoute } from "@/server/admin/http";
import { addOnBehalf } from "@/server/admin/member-tools";
import { logActivity } from "@/server/admin/volunteers";
import { sendOtp, verifyOtp } from "@/server/otp";
import { formatPhone, normalizeIndianPhone } from "@/lib/phone";

// Admins only. Adds a member for someone who can't do it on their phone: a code goes to their number,
// they read it out, the admin types it. They answer the join form the first time they open the app.
// POST { step: "send", phone } → { resendAfterSec, simulated } | 409 already_member | other_sangh
// POST { step: "confirm", phone, code, name, classId } → { profileId }
const body = z.discriminatedUnion("step", [
  z.object({ step: z.literal("send"), phone: z.string().max(20) }),
  z.object({ step: z.literal("confirm"), phone: z.string().max(20), code: z.string().regex(/^\d{4,6}$/),
    name: z.string().trim().min(1).max(60), classId: z.uuid().nullable().default(null) }),
]);

export const POST = sanghRoute("admin.members.add", async (req, ctx) => {
  const input = await readJson(req, body);
  if (!input) return fail(ctx, { error: "bad_request" });
  const phone = normalizeIndianPhone(input.phone);
  if (!phone) return fail(ctx, { error: "invalid_phone" });
  const [existing] = await sql()`select sangh_id from public.accounts where phone = ${phone}`;
  if (existing) return fail(ctx, { error: existing.sangh_id === ctx.sanghId ? "already_member" : "other_sangh" });

  if (input.step === "send") {
    const limited = await limitIp(ctx, "otp_send", config().RL_OTP_SEND_PER_IP_HOUR, 3600);
    if (limited) return limited;
    const r = await sendOtp(phone, "sms");
    if (!r.ok) return r.reason === "too_many_requests" ? fail(ctx, { error: "too_many_requests", retryAfterSec: r.retryAfterSec }) : fail(ctx, { error: "send_failed" });
    return ok(ctx, { resendAfterSec: r.resendAfterSec, simulated: r.simulated });
  }
  const limited = await limitIp(ctx, "otp_verify", config().RL_VERIFY_PER_IP_HOUR, 3600);
  if (limited) return limited;
  const v = await verifyOtp(phone, input.code);
  if (!v.ok) return v.reason === "wrong_code" ? fail(ctx, { error: "wrong_code", attemptsLeft: v.attemptsLeft }) : fail(ctx, { error: v.reason });
  const r = await addOnBehalf(ctx.admin.phone, ctx.sanghId, phone, input.name, input.classId);
  if (!r.ok) return fail(ctx, { error: r.reason });
  await logActivity(ctx.admin.phone, ctx.sanghId, "Added a member", `${input.name} (${formatPhone(phone)})`);
  return ok(ctx, { profileId: r.profileId });
});
