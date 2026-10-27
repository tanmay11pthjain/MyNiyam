import "server-only";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { config } from "./config";
import { sql } from "./db";
import { deliverOtp } from "./msg91";
import { log } from "./log";
import type { OtpChannel } from "@/lib/api-types";
import { OTP_LENGTH } from "@/lib/otp-code";

/** The code that always works while OTP_DELIVERY=simulate, and for the DEMO_PHONES numbers. */
export const SIMULATED_CODE = "1234";

function hashCode(phone: string, code: string) {
  return createHmac("sha256", config().sessionSecret).update(`otp:${phone}:${code}`).digest("hex");
}

export type SendResult =
  | { ok: true; channel: OtpChannel; resendAfterSec: number; expiresInSec: number; simulated: boolean }
  | { ok: false; reason: "too_many_requests"; retryAfterSec: number }
  | { ok: false; reason: "send_failed" };

/**
 * Creates a fresh 4-digit code for `phone` (E.164) and sends it. Server code only.
 * Limits: OTP_SENDS_PER_WINDOW sends per number per OTP_WINDOW_SEC, and at least
 * OTP_RESEND_AFTER_SEC between two sends. Each send replaces the previous code.
 */
export async function sendOtp(phone: string, channel: OtpChannel): Promise<SendResult> {
  const c = config();
  // The demo numbers (DEMO_PHONES) keep the fixed code even after real SMS is switched on, so the
  // demo family and admin still work; every other number gets a random code by SMS.
  const simulated = c.OTP_DELIVERY === "simulate" || c.demoPhones.includes(phone);
  const code = simulated ? SIMULATED_CODE : String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, "0");

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
    if (w.n >= c.OTP_SENDS_PER_WINDOW) {
      const reset = new Date(w.oldest).getTime() + c.OTP_WINDOW_SEC * 1000;
      return { ok: false as const, retryAfterSec: Math.max(1, Math.ceil((reset - now) / 1000)) };
    }
    if (w.newest) {
      const wait = new Date(w.newest).getTime() + c.OTP_RESEND_AFTER_SEC * 1000 - now;
      if (wait > 0) return { ok: false as const, retryAfterSec: Math.ceil(wait / 1000) };
    }
    await tx`insert into private.otp_sends (phone, channel) values (${phone}, ${channel})`;
    await tx`
      insert into private.otp_codes (phone, code_hash, channel, attempts, expires_at)
      values (${phone}, ${hashCode(phone, code)}, ${channel}, 0, now() + make_interval(secs => ${c.OTP_TTL_SEC}))
      on conflict (phone) do update set code_hash = excluded.code_hash, channel = excluded.channel,
        attempts = 0, expires_at = excluded.expires_at, created_at = now()`;
    return { ok: true as const };
  });
  if (!gate.ok) return { ok: false, reason: "too_many_requests", retryAfterSec: gate.retryAfterSec };

  let used: OtpChannel = channel;
  if (!simulated) {
    try {
      used = await deliverOtp(phone, code, channel);
    } catch (e) {
      log.error("otp_delivery_failed", { channel, error: (e as Error).message });
      await sql()`delete from private.otp_codes where phone = ${phone}`;
      return { ok: false, reason: "send_failed" };
    }
  }
  return { ok: true, channel: used, resendAfterSec: c.OTP_RESEND_AFTER_SEC, expiresInSec: c.OTP_TTL_SEC, simulated };
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
