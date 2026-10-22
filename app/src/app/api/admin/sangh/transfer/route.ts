import { z } from "zod";
import { config } from "@/server/config";
import { fail, limitIp, ok, readJson } from "@/server/http";
import { sanghRoute } from "@/server/admin/http";
import { transferSangh } from "@/server/admin/member-tools";
import { sendOtp, verifyOtp } from "@/server/otp";
import { normalizeIndianPhone } from "@/lib/phone";

// Admins only. Hands the pathshala to another number. A code goes to both numbers; both are needed.
// POST { step: "send", phone } → { simulated }
// POST { step: "confirm", phone, myCode, theirCode } → { ok }   the caller is no longer an admin here
const body = z.discriminatedUnion("step", [
  z.object({ step: z.literal("send"), phone: z.string().max(20) }),
  z.object({ step: z.literal("confirm"), phone: z.string().max(20), myCode: z.string().regex(/^\d{4,6}$/), theirCode: z.string().regex(/^\d{4,6}$/) }),
]);

export const POST = sanghRoute("admin.sangh.transfer", async (req, ctx) => {
  const input = await readJson(req, body);
  if (!input) return fail(ctx, { error: "bad_request" });
  const phone = normalizeIndianPhone(input.phone);
  if (!phone) return fail(ctx, { error: "invalid_phone" });
  if (phone === ctx.admin.phone) return fail(ctx, { error: "same_number" });

  if (input.step === "send") {
    const limited = await limitIp(ctx, "otp_send", config().RL_OTP_SEND_PER_IP_HOUR, 3600);
    if (limited) return limited;
    for (const p of [ctx.admin.phone, phone]) {
      const r = await sendOtp(p, "sms");
      if (!r.ok) return r.reason === "too_many_requests" ? fail(ctx, { error: "too_many_requests", retryAfterSec: r.retryAfterSec }) : fail(ctx, { error: "send_failed" });
    }
    return ok(ctx, { simulated: config().OTP_DELIVERY === "simulate" });
  }
  const limited = await limitIp(ctx, "otp_verify", config().RL_VERIFY_PER_IP_HOUR, 3600);
  if (limited) return limited;
  for (const [p, code] of [[ctx.admin.phone, input.myCode], [phone, input.theirCode]] as const) {
    const v = await verifyOtp(p, code);
    if (!v.ok) return v.reason === "wrong_code" ? fail(ctx, { error: "wrong_code", attemptsLeft: v.attemptsLeft }) : fail(ctx, { error: v.reason });
  }
  if ((await transferSangh(ctx.admin.phone, ctx.sanghId, phone)) === "same_number") return fail(ctx, { error: "same_number" });
  return ok(ctx, { ok: true });
});
