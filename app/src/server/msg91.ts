import "server-only";
import { config } from "./config";
import type { OtpChannel } from "@/lib/api-types";

// MSG91 delivery. We generate and check the code ourselves (see otp.ts); MSG91 only carries it.
// That keeps one expiry, one rate limit and one attempt counter for both WhatsApp and SMS.

export class DeliveryError extends Error {}

const TIMEOUT_MS = 8000;

async function post(url: string, body: unknown): Promise<unknown> {
  const c = config();
  const res = await fetch(url, {
    method: "POST",
    headers: { authkey: c.MSG91_AUTH_KEY!, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* MSG91 sometimes answers in plain text */ }
  const failed = !res.ok || (json && typeof json === "object" && (json as { type?: string }).type === "error");
  if (failed) {
    // Never log the code or the full number.
    throw new DeliveryError(`MSG91 ${res.status}: ${text.slice(0, 200)}`);
  }
  return json;
}

/** SMS through MSG91's OTP API, using a DLT-approved OTP template. `mobile` is 91XXXXXXXXXX. */
async function sendSms(mobile: string, code: string) {
  const c = config();
  const minutes = Math.ceil(c.OTP_TTL_SEC / 60);
  const qs = new URLSearchParams({ template_id: c.MSG91_SMS_TEMPLATE_ID!, mobile, otp: code, otp_expiry: String(minutes) });
  await post(`https://control.msg91.com/api/v5/otp?${qs}`, {});
}

/** WhatsApp through MSG91's outbound template API, using an approved "authentication" template. */
async function sendWhatsApp(mobile: string, code: string) {
  const c = config();
  await post("https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/", {
    integrated_number: c.MSG91_WHATSAPP_NUMBER,
    content_type: "template",
    payload: {
      messaging_product: "whatsapp",
      type: "template",
      template: {
        name: c.MSG91_WHATSAPP_TEMPLATE,
        language: { code: c.MSG91_WHATSAPP_LANGUAGE, policy: "deterministic" },
        ...(c.MSG91_WHATSAPP_NAMESPACE ? { namespace: c.MSG91_WHATSAPP_NAMESPACE } : {}),
        to_and_components: [
          {
            to: [mobile],
            components: {
              body_1: { type: "text", value: code },
              button_1: { subtype: "url", type: "text", value: code }, // "Copy code" button
            },
          },
        ],
      },
    },
  });
}

/**
 * Delivers `code` to `phone` (E.164). Returns the channel actually used: if WhatsApp isn't
 * configured, it falls back to SMS so the screen never claims a WhatsApp message that wasn't sent.
 */
export async function deliverOtp(phone: string, code: string, wanted: OtpChannel): Promise<OtpChannel> {
  const c = config();
  const mobile = phone.replace(/^\+/, "");
  if (wanted === "whatsapp" && c.whatsappEnabled) {
    await sendWhatsApp(mobile, code);
    return "whatsapp";
  }
  if (c.smsEnabled) {
    await sendSms(mobile, code);
    return "sms";
  }
  throw new DeliveryError("MSG91 is not configured: set MSG91_AUTH_KEY and MSG91_SMS_TEMPLATE_ID (and the WhatsApp ones for WhatsApp).");
}
