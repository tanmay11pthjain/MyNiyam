import { z } from "zod";
import { config } from "@/server/config";
import { fail, limitIp, ok, readJson, route } from "@/server/http";
import { verifyOtp } from "@/server/otp";
import { accountByPhone, findSanghById, joinSangh } from "@/server/onboarding";
import { setSession } from "@/server/session";
import { normalizeIndianPhone } from "@/lib/phone";
import type { VerifyOtpResponse } from "@/lib/api-types";
import { OTP_PATTERN } from "@/lib/otp-code";

const body = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("join"), phone: z.string().max(20), code: z.string().regex(OTP_PATTERN), sanghId: z.uuid() }),
  z.object({ intent: z.literal("login"), phone: z.string().max(20), code: z.string().regex(OTP_PATTERN) }),
]);

// POST /api/otp/verify
//   join:  { intent: "join", phone, code, sanghId } → { status: "joined" | "logged_in" } | 409 other_sangh
//   login: { intent: "login", phone, code }          → { status: "logged_in" } | 404 not_member
// Sets the session cookie whenever the number is proven and has an account.
export const POST = route("otp.verify", async (req, ctx) => {
  const input = await readJson(req, body);
  if (!input) return fail(ctx, { error: "bad_request" });
  const phone = normalizeIndianPhone(input.phone);
  if (!phone) return fail(ctx, { error: "invalid_phone" });
  const limited = await limitIp(ctx, "otp_verify", config().RL_VERIFY_PER_IP_HOUR, 3600);
  if (limited) return limited;
  if (input.intent === "join" && !(await findSanghById(input.sanghId))) return fail(ctx, { error: "not_found" });

  const v = await verifyOtp(phone, input.code);
  if (!v.ok) {
    if (v.reason === "wrong_code") return fail(ctx, { error: "wrong_code", attemptsLeft: v.attemptsLeft });
    return fail(ctx, { error: v.reason });
  }

  if (input.intent === "login") {
    const acc = await accountByPhone(phone);
    if (!acc) return fail(ctx, { error: "not_member" });
    const res = ok<VerifyOtpResponse>(ctx, { status: "logged_in" });
    await setSession(res, { accountId: acc.id, profileId: null });
    return res;
  }

  let outcome;
  try {
    outcome = await joinSangh(phone, input.sanghId);
  } catch {
    outcome = await joinSangh(phone, input.sanghId); // the number was freed mid-join; one retry settles it
  }
  if (outcome.kind === "closed") return fail(ctx, { error: "joins_closed" });
  // The number is proven, so the session is set even when it belongs to another sangh:
  // the screen then offers "Log in there" (keep it) or "Use a different number" (log out).
  if (outcome.kind === "other_sangh") {
    const res = fail(ctx, { error: "other_sangh", sangh: outcome.sangh });
    await setSession(res, { accountId: outcome.accountId, profileId: null });
    return res;
  }
  const res = ok<VerifyOtpResponse>(ctx, { status: outcome.kind });
  await setSession(res, { accountId: outcome.accountId, profileId: null });
  return res;
});
