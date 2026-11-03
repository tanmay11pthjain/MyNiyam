import "server-only";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { config } from "./config";
import { sql } from "./db";
import { deliverOtp } from "./msg91";
import { otpText, sendViaPhone } from "./sms-phone";
import { log } from "./log";
import type { OtpChannel } from "@/lib/api-types";
import { OTP_LENGTH } from "@/lib/otp-code";

/** The code that always works while OTP_DELIVERY=simulate, and for the DEMO_PHONES numbers. */
export const SIMULATED_CODE = "1234";

function hashCode(phone: string, code: string) {
  return createHmac("sha256", config().sessionSecret).update(`otp:${phone}:${code}`).digest("hex");
}

export type SendResult =
  | { ok: true; channel: OtpChannel; resendAfterSec: number; expiresInSec: number; simulated: boolean; sendsLeft: number }
  | { ok: false; reason: "too_many_requests"; retryAfterSec: number }
  | { ok: false; reason: "send_failed" };

/** Seconds to wait after the `n`th code (1-based) before the next one: 60, then 120 by default. */
export function waitAfter(n: number): number {
  const w = config().resendWaits;
  return w[Math.min(Math.max(n, 1), w.length) - 1];
}

/**
 * Creates a fresh random 4-digit code for `phone` (E.164) and sends it. Server code only.
 * Limits per number: OTP_SENDS_PER_WINDOW codes per OTP_WINDOW_SEC (3 per 24 hours), and a growing
 * wait between codes (OTP_RESEND_WAITS: 60 s, then 120 s). Each send replaces the
 * previous code, and every code is written to private.otp_log so the super admin can check it.
 * A delivery that fails does not count toward the limits.
 */
export async function sendOtp(phone: string, channel: OtpChannel): Promise<SendResult> {
  const c = config();
  // The demo numbers (DEMO_PHONES) keep the fixed code even after real SMS is switched on, so the
  // demo family and admin still work; every other number gets a random code.
  const demo = c.demoPhones.includes(phone);
  const simulated = c.OTP_DELIVERY === "simulate" || demo;
  const code = simulated ? SIMULATED_CODE : String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, "0");
  const delivery = simulated ? "practice" : c.OTP_DELIVERY;

  const gate = await sql().begin(async (tx) => {
    // One sender at a time per number, so two taps or two tabs can't both slip under the limit.
    await tx`select pg_advisory_xact_lock(hashtext(${"otp:" + phone}))`;
    const [w] = await tx`
      select count(*)::int as n,
             min(sent_at) as oldest,
             max(sent_at) as newest,
             now() as now
      from private.otp_sends
      where phone = ${phone} and sent_at > now() - make_interval(secs => ${c.OTP_WINDOW_SEC})`;
    const now = new Date(w.now).getTime();
    const resetAt = (w.oldest ? new Date(w.oldest).getTime() : now) + c.OTP_WINDOW_SEC * 1000;
    // Demo numbers are shared by everyone trying the demo, so they skip the per-number limits.
    if (!demo) {
      if (w.n >= c.OTP_SENDS_PER_WINDOW) {
        return { ok: false as const, retryAfterSec: Math.max(1, Math.ceil((resetAt - now) / 1000)) };
      }
      if (w.newest) {
        const wait = new Date(w.newest).getTime() + waitAfter(w.n) * 1000 - now;
        if (wait > 0) return { ok: false as const, retryAfterSec: Math.ceil(wait / 1000) };
      }
    }
    const [send] = await tx`insert into private.otp_sends (phone, channel) values (${phone}, ${channel}) returning id`;
    await tx`
      insert into private.otp_codes (phone, code_hash, channel, attempts, expires_at)
      values (${phone}, ${hashCode(phone, code)}, ${channel}, 0, now() + make_interval(secs => ${c.OTP_TTL_SEC}))
      on conflict (phone) do update set code_hash = excluded.code_hash, channel = excluded.channel,
        attempts = 0, expires_at = excluded.expires_at, created_at = now()`;
    const [entry] = await tx`
      insert into private.otp_log (phone, code, delivery, channel, status)
      values (${phone}, ${code}, ${delivery}, ${channel}, ${simulated ? "practice" : "sending"}) returning id`;
    const count = w.n + 1;
    const sendsLeft = demo ? c.OTP_SENDS_PER_WINDOW : Math.max(0, c.OTP_SENDS_PER_WINDOW - count);
    // When this was the last code for today, the screen counts down to when the 24 hours are up.
    const resendAfterSec = demo ? waitAfter(1) : sendsLeft > 0 ? waitAfter(count) : Math.ceil((resetAt - now) / 1000);
    return { ok: true as const, sendId: Number(send.id), logId: Number(entry.id), sendsLeft, resendAfterSec };
  });
  if (!gate.ok) return { ok: false, reason: "too_many_requests", retryAfterSec: gate.retryAfterSec };

  let used: OtpChannel = channel;
  if (!simulated) {
    try {
      if (c.OTP_DELIVERY === "phone") {
        await sendViaPhone(phone, otpText(code), gate.logId);
        used = "sms";
      } else {
        used = await deliverOtp(phone, code, channel);
      }
    } catch (e) {
      const why = (e as Error).message.slice(0, 200);
      log.error("otp_delivery_failed", { channel, error: why });
      // Not the user's fault, so it doesn't use up one of their codes or start a wait.
      await sql().begin(async (tx) => {
        await tx`delete from private.otp_codes where phone = ${phone}`;
        await tx`delete from private.otp_sends where id = ${gate.sendId}`;
        await tx`update private.otp_log set status = 'failed', error = ${why}, updated_at = now() where id = ${gate.logId}`;
      });
      return { ok: false, reason: "send_failed" };
    }
    // "queued": the phone has it in its queue; it reports sent / delivered later (see otp-log.ts).
    await sql()`update private.otp_log set status = ${c.OTP_DELIVERY === "phone" ? "queued" : "sent"}, channel = ${used}, updated_at = now() where id = ${gate.logId}`;
  }
  return {
    ok: true, channel: used, resendAfterSec: gate.resendAfterSec, expiresInSec: c.OTP_TTL_SEC, simulated, sendsLeft: gate.sendsLeft,
  };
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "no_code" | "code_expired" }
  | { ok: false; reason: "wrong_code"; attemptsLeft: number };

/** Checks a code. A correct code works exactly once; too many wrong guesses burn it. */
export async function verifyOtp(phone: string, code: string): Promise<VerifyResult> {
  const c = config();
  return sql().begin(async (tx) => {
    const [row] = await tx`
      select code_hash, attempts, expires_at < now() as expired
      from private.otp_codes where phone = ${phone} for update`;
    if (!row) return { ok: false as const, reason: "no_code" as const };
    if (row.expired || row.attempts >= c.OTP_MAX_ATTEMPTS) {
      await tx`delete from private.otp_codes where phone = ${phone}`;
      return { ok: false as const, reason: "code_expired" as const };
    }
    const a = Buffer.from(row.code_hash, "hex");
    const b = Buffer.from(hashCode(phone, code), "hex");
    if (a.length === b.length && timingSafeEqual(a, b)) {
      await tx`delete from private.otp_codes where phone = ${phone}`;
      await tx`
        update private.otp_log set status = 'verified', verified_at = now(), updated_at = now()
        where id = (select max(id) from private.otp_log where phone = ${phone})`;
      return { ok: true as const };
    }
    const attempts = row.attempts + 1;
    await tx`update private.otp_codes set attempts = ${attempts} where phone = ${phone}`;
    const attemptsLeft = Math.max(0, c.OTP_MAX_ATTEMPTS - attempts);
    if (attemptsLeft === 0) {
      await tx`delete from private.otp_codes where phone = ${phone}`;
      return { ok: false as const, reason: "code_expired" as const };
    }
    return { ok: false as const, reason: "wrong_code" as const, attemptsLeft };
  });
}
