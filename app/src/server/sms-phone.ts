import "server-only";
import { config } from "./config";
import { DeliveryError } from "./msg91";

// Delivery through our own phone running the MyNiyam SMS Gateway app (OTP_DELIVERY=phone).
// The server posts the SMS to the app's secret ntfy topic; the phone is listening on it and sends
// the SMS from its own SIM. The phone then posts what happened (sent / delivered / failed) to
// "<topic>-status", which the super admin's OTP log reads (see otp-log.ts).

const TIMEOUT_MS = 8000;

export function otpText(code: string): string {
  const minutes = Math.ceil(config().OTP_TTL_SEC / 60);
  return `${code} is your MyNiyam login code. It works for ${minutes} minutes. Do not share it with anyone.`;
}

/** Hands the SMS to the relay. Resolves once the relay has it; the phone sends it a moment later. */
export async function sendViaPhone(phone: string, text: string, logId: number): Promise<void> {
  const c = config();
  let res: Response;
  try {
    res = await fetch(`${c.SMS_PHONE_RELAY}/${c.SMS_PHONE_TOPIC}`, {
      method: "POST",
      // ntfy keeps it for a few hours, so a phone that was briefly offline still gets it on reconnect.
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ to: phone, message: text, id: String(logId) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new DeliveryError(`relay unreachable: ${(e as Error).name}`);
  }
  if (!res.ok) {
    const why = res.status === 429 ? "relay is rate-limiting us (too many messages)" : `relay answered ${res.status}`;
    throw new DeliveryError(why);
  }
}

export type PhoneReport = { logId: number; status: "sent" | "delivered" | "failed"; error: string | null; at: Date };

/** What the phone reported in the last `sinceSec` seconds. Never throws: a relay hiccup just means no news. */
export async function phoneReports(sinceSec: number): Promise<{ reports: PhoneReport[]; reachable: boolean }> {
  const c = config();
  if (!c.SMS_PHONE_TOPIC) return { reports: [], reachable: false };
  try {
    const res = await fetch(`${c.SMS_PHONE_RELAY}/${c.SMS_PHONE_TOPIC}-status/json?poll=1&since=${sinceSec}s`, {
      signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store",
    });
    if (!res.ok) return { reports: [], reachable: false };
    const reports: PhoneReport[] = [];
    for (const line of (await res.text()).split("\n")) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line) as { event?: string; time?: number; message?: string };
        if (ev.event !== "message" || !ev.message) continue;
        const m = JSON.parse(ev.message) as { id?: unknown; status?: unknown; error?: unknown };
        const logId = Number(m.id);
        if (!Number.isSafeInteger(logId) || logId <= 0) continue;
        if (m.status !== "sent" && m.status !== "delivered" && m.status !== "failed") continue;
        reports.push({ logId, status: m.status, error: typeof m.error === "string" ? m.error.slice(0, 200) : null, at: new Date((ev.time ?? 0) * 1000) });
      } catch { /* not ours */ }
    }
    return { reports, reachable: true };
  } catch {
    return { reports: [], reachable: false };
  }
}
