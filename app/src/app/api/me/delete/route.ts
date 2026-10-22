import { z } from "zod";
import { config } from "@/server/config";
import { fail, limitIp, ok, readJson, route } from "@/server/http";
import { sendOtp, verifyOtp } from "@/server/otp";
import { deleteMyAccount } from "@/server/privacy";
import { clearSession, readSession } from "@/server/session";

const body = z.discriminatedUnion("step", [
  z.object({ step: z.literal("send"), channel: z.enum(["whatsapp", "sms"]).default("whatsapp") }),
  z.object({ step: z.literal("confirm"), code: z.string().regex(/^\d{4,6}$/) }),
]);

// POST /api/me/delete { step: "send" } → { channel, resendAfterSec, simulated }   a fresh code to this number
// POST /api/me/delete { step: "confirm", code } → { ok }   deletes the number, everyone on it and all logs, now
export const POST = route("me.delete", async (req, ctx) => {
  const s = await readSession(req);
  if (!s) return fail(ctx, { error: "unauthorized" });
  const input = await readJson(req, body);
  if (!input) return fail(ctx, { error: "bad_request" });
  if (input.step === "send") {
    const limited = await limitIp(ctx, "otp_send", config().RL_OTP_SEND_PER_IP_HOUR, 3600);
    if (limited) return limited;
    const r = await sendOtp(s.phone, input.channel);
    if (!r.ok) return r.reason === "too_many_requests" ? fail(ctx, { error: "too_many_requests", retryAfterSec: r.retryAfterSec }) : fail(ctx, { error: "send_failed" });
    return ok(ctx, { channel: r.channel, resendAfterSec: r.resendAfterSec, simulated: r.simulated });
  }
  const limited = await limitIp(ctx, "otp_verify", config().RL_VERIFY_PER_IP_HOUR, 3600);
  if (limited) return limited;
  const v = await verifyOtp(s.phone, input.code);
  if (!v.ok) return v.reason === "wrong_code" ? fail(ctx, { error: "wrong_code", attemptsLeft: v.attemptsLeft }) : fail(ctx, { error: v.reason });
  await deleteMyAccount(s.accountId);
  const res = ok(ctx, { ok: true });
  clearSession(res);
  return res;
});
