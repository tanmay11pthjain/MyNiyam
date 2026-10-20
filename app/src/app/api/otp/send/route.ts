import { z } from "zod";
import { config } from "@/server/config";
import { fail, limitIp, ok, readJson, route } from "@/server/http";
import { sendOtp } from "@/server/otp";
import { normalizeIndianPhone } from "@/lib/phone";
import type { SendOtpResponse } from "@/lib/api-types";

const body = z.object({ phone: z.string().max(20), channel: z.enum(["whatsapp", "sms"]).default("whatsapp") });

// POST /api/otp/send { phone, channel } → { channel, resendAfterSec, expiresInSec, testMode }
export const POST = route("otp.send", async (req, ctx) => {
  const input = await readJson(req, body);
  if (!input) return fail(ctx, { error: "bad_request" });
  const phone = normalizeIndianPhone(input.phone);
  if (!phone) return fail(ctx, { error: "invalid_phone" });
  const limited = await limitIp(ctx, "otp_send", config().RL_OTP_SEND_PER_IP_HOUR, 3600);
  if (limited) return limited;

  const r = await sendOtp(phone, input.channel);
  if (!r.ok) {
    if (r.reason === "too_many_requests") return fail(ctx, { error: "too_many_requests", retryAfterSec: r.retryAfterSec });
    return fail(ctx, { error: "send_failed" });
  }
  return ok<SendOtpResponse>(ctx, { channel: r.channel, resendAfterSec: r.resendAfterSec, expiresInSec: r.expiresInSec, testMode: r.testMode });
});
