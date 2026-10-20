"use client";
import type { ApiError } from "@/lib/api-types";

export type Result<T> = { ok: true; data: T } | { ok: false; err: ApiError | { error: "offline" } };

/** fetch() for our JSON API. Never throws: network trouble comes back as { error: "offline" }. */
export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<Result<T>> {
  try {
    const res = await fetch(path, {
      method: init?.method ?? (init?.body ? "POST" : "GET"),
      headers: init?.body ? { "content-type": "application/json" } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
    });
    const json = await res.json().catch(() => ({ error: "server_error" }));
    return res.ok ? { ok: true, data: json as T } : { ok: false, err: json as ApiError };
  } catch {
    return { ok: false, err: { error: "offline" } };
  }
}

type Words = { en: string; hi: string };

function minutes(sec = 60) {
  const m = Math.ceil(sec / 60);
  return sec < 60 ? { en: `${sec} seconds`, hi: `${sec} सेकंड` } : { en: m === 1 ? "1 minute" : `${m} minutes`, hi: `${m} मिनट` };
}

/** Human words (English and Hindi) for an error code. */
export function say(err: ApiError | { error: "offline" }): Words {
  switch (err.error) {
    case "offline": return { en: "No internet. Check your connection and try again.", hi: "इंटरनेट नहीं है। कनेक्शन देखकर फिर कोशिश करें।" };
    case "invalid_code": return { en: "A pathshala code has 6 letters or numbers, like HEER01.", hi: "पाठशाला कोड में 6 अक्षर या अंक होते हैं, जैसे HEER01." };
    case "code_not_found": return { en: "We couldn't find that code. Check it with your teacher.", hi: "यह कोड नहीं मिला। अपने शिक्षक से पूछें।" };
    case "invalid_phone": return { en: "Enter a 10-digit mobile number.", hi: "10 अंकों का मोबाइल नंबर लिखें।" };
    case "too_many_requests": { const t = minutes("retryAfterSec" in err ? err.retryAfterSec : 60); return { en: `Too many tries. Please wait ${t.en} and try again.`, hi: `बहुत बार कोशिश हुई। ${t.hi} बाद फिर कोशिश करें।` }; }
    case "send_failed": return { en: "We couldn't send the code just now. Try again, or send it by SMS.", hi: "अभी कोड नहीं भेज पाए। फिर कोशिश करें या SMS से मँगाएँ।" };
    case "wrong_code": { const n = "attemptsLeft" in err ? err.attemptsLeft : undefined; return { en: `That code is not right.${n ? ` ${n} ${n === 1 ? "try" : "tries"} left.` : ""}`, hi: `कोड सही नहीं है।${n ? ` ${n} बार और।` : ""}` }; }
    case "code_expired":
    case "no_code": return { en: "This code has expired. Send a new one.", hi: "यह कोड पुराना हो गया। नया कोड मँगाएँ।" };
    case "consent_required": return { en: "Please tick the box to give consent for your child.", hi: "बच्चे के लिए सहमति देने को बॉक्स पर टिक करें।" };
    case "self_exists": return { en: "\"Myself\" is already added on this number.", hi: "इस नंबर पर \"मैं खुद\" पहले से जुड़ा है।" };
    case "profile_limit": return { en: "This number already has the most people it can hold.", hi: "इस नंबर पर और लोग नहीं जुड़ सकते।" };
    case "invalid_answers": return { en: "Please check the answers marked below.", hi: "नीचे दिखाए जवाब देखें।" };
    case "invalid_class": return { en: "Please pick your class again.", hi: "अपनी कक्षा फिर से चुनें।" };
    case "unauthorized": return { en: "Please log in again.", hi: "फिर से लॉग इन करें।" };
    case "joins_closed": return { en: "This pathshala isn't taking new members right now. Ask your teacher.", hi: "यह पाठशाला अभी नए सदस्य नहीं ले रही। अपने शिक्षक से पूछें।" };
    default: return { en: "Something went wrong on our side. Please try again.", hi: "हमारी तरफ़ से गड़बड़ हुई। फिर कोशिश करें।" };
  }
}

export const fieldError: Record<string, Words> = {
  required: { en: "Please fill this in.", hi: "यह भरना ज़रूरी है।" },
  too_long: { en: "That's too long.", hi: "बहुत लंबा है।" },
  not_a_number: { en: "Enter a number.", hi: "अंक लिखें।" },
  out_of_range: { en: "That number is out of range.", hi: "यह अंक सही सीमा में नहीं है।" },
  bad_date: { en: "Pick a real date.", hi: "सही तारीख चुनें।" },
  bad_option: { en: "Pick one of the options.", hi: "कोई एक विकल्प चुनें।" },
};
