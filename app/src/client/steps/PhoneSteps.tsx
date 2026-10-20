"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, say } from "../api";
import { Button, Msg, Title } from "../ui";
import { formatPhone, normalizeIndianPhone } from "@/lib/phone";
import type { OtpChannel, SendOtpResponse } from "@/lib/api-types";
import { OTP_LENGTH, OTP_PATTERN } from "@/lib/otp-code";

type Words = { en: string; hi: string };
export type Sent = SendOtpResponse & { phone: string; at: number };

/** Short privacy notice shown before sign-up (placeholder text until the final policy is written). */
export function PrivacyNotice() {
  return (
    <div className="notice">
      <b>Your privacy</b>
      <span>We use your number only to log you in and to link you to your pathshala. Your pathshala sees the names and niyams of the people on your number. We never sell your data or show ads. <Link href="/privacy">Read more</Link></span>
      <span lang="hi">आपका नंबर सिर्फ़ लॉग इन और पाठशाला से जोड़ने के लिए है। हम आपका डेटा कभी नहीं बेचते।</span>
    </div>
  );
}

/** Asks for the number and sends the first code on WhatsApp. */
export function PhoneStep({ title, onSent, initialPhone }: {
  title: { en: string; hi: string; lead: string }; onSent: (s: Sent) => void; initialPhone?: string;
}) {
  const [digits, setDigits] = useState(initialPhone?.replace(/^\+91/, "") ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Words | null>(null);

  async function send() {
    const phone = normalizeIndianPhone(digits);
    if (!phone) { setErr(say({ error: "invalid_phone" })); return; }
    setBusy(true); setErr(null);
    const r = await api<SendOtpResponse>("/api/otp/send", { body: { phone, channel: "whatsapp" } });
    setBusy(false);
    if (r.ok) onSent({ ...r.data, phone, at: Date.now() });
    else setErr(say(r.err));
  }

  return (
    <div className="screen">
      <Title en={title.en} hi={title.hi} lead={title.lead} />
      <form className="stack mt-6" noValidate onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <label className="label" htmlFor="phone">Mobile number <span className="hi" lang="hi">मोबाइल नंबर</span></label>
        <div className="phone-row" data-invalid={err ? true : undefined}>
          <span className="cc" aria-hidden="true">+91</span>
          <input
            id="phone" type="tel" inputMode="numeric" autoComplete="tel-national" placeholder="98200 12345" maxLength={14}
            value={digits} aria-describedby="phone-msg phone-hint" aria-invalid={err ? true : undefined}
            onChange={(e) => { setDigits(e.target.value.replace(/[^\d ]/g, "")); setErr(null); }}
          />
        </div>
        <p className="hint" id="phone-hint">Children can use a parent&apos;s number. <span lang="hi">बच्चे माता-पिता का नंबर इस्तेमाल करें।</span></p>
        <Msg id="phone-msg" text={err} />
        <Button type="submit" busy={busy} disabled={digits.replace(/\D/g, "").length < 10}>
          {busy ? "Sending code…" : "Send code on WhatsApp"}
        </Button>
      </form>
      <div className="mt-5"><PrivacyNotice /></div>
    </div>
  );
}

/** The login code (4 digits). "Send by SMS instead" appears once the resend wait is over. */
export function OtpStep({ sent, onResent, onVerify, onChangeNumber }: {
  sent: Sent;
  onResent: (s: Sent) => void;
  onVerify: (code: string) => Promise<Words | null>; // returns an error to show, or null when it moved on
  onChangeNumber: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<false | "verify" | OtpChannel>(false);
  const [err, setErr] = useState<Words | null>(null);
  const [note, setNote] = useState<Words | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { input.current?.focus(); }, [sent.at]);

  const wait = Math.max(0, Math.ceil((sent.at + sent.resendAfterSec * 1000 - now) / 1000));

  async function verify(c: string) {
    if (!OTP_PATTERN.test(c)) return;
    setBusy("verify"); setErr(null); setNote(null);
    const problem = await onVerify(c);
    setBusy(false);
    if (problem) { setErr(problem); setCode(""); input.current?.focus(); }
  }

  async function resend(channel: OtpChannel) {
    setBusy(channel); setErr(null); setNote(null);
    const r = await api<SendOtpResponse>("/api/otp/send", { body: { phone: sent.phone, channel } });
    setBusy(false);
    if (r.ok) {
      onResent({ ...r.data, phone: sent.phone, at: Date.now() });
      setCode("");
      setNote(r.data.channel === "sms" ? { en: "New code sent by SMS.", hi: "नया कोड SMS से भेजा।" } : { en: "New code sent on WhatsApp.", hi: "नया कोड WhatsApp पर भेजा।" });
    } else setErr(say(r.err));
  }

  const where = sent.channel === "whatsapp" ? "WhatsApp" : "SMS";
  return (
    <div className="screen">
      <Title en="Enter the code" hi="कोड डालें" lead={sent.simulated
        ? <>For now no message is sent to <b style={{ whiteSpace: "nowrap" }}>{formatPhone(sent.phone)}</b>. Type 1234.</>
        : <>We sent a {OTP_LENGTH}-digit code on <b>{where}</b> to <b style={{ whiteSpace: "nowrap" }}>{formatPhone(sent.phone)}</b>.</>} />
      {sent.simulated && <p className="pill kesar mt-4" style={{ alignSelf: "flex-start" }}>Practice mode: no message is sent. The code is 1234.</p>}
      <form className="stack mt-5" noValidate onSubmit={(e) => { e.preventDefault(); void verify(code); }}>
        <label className="label sr-only" htmlFor="otp">{OTP_LENGTH}-digit code</label>
        <input
          ref={input} id="otp" className="input otp-input" inputMode="numeric" autoComplete="one-time-code" pattern="\d*"
          maxLength={OTP_LENGTH} placeholder={"•".repeat(OTP_LENGTH)} value={code} aria-invalid={err ? true : undefined} aria-describedby="otp-msg"
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH);
            setCode(v); setErr(null);
            if (v.length === OTP_LENGTH && !busy) void verify(v);
          }}
        />
        <Msg id="otp-msg" text={err ?? note} tone={err ? "err" : "ok"} />
        <Button type="submit" busy={busy === "verify"} disabled={code.length !== OTP_LENGTH}>{busy === "verify" ? "Checking…" : "Continue"}</Button>
      </form>

      <div className="stack mt-5">
        {wait > 0 ? (
          <p className="hint center" aria-live="off">Didn&apos;t get it? You can ask again in {wait} s. The code works for {Math.round(sent.expiresInSec / 60)} minutes.</p>
        ) : (
          <>
            {sent.channel === "whatsapp" && <Button kind="secondary" busy={busy === "sms"} onClick={() => void resend("sms")}>Send by SMS instead</Button>}
            <Button kind={sent.channel === "whatsapp" ? "quiet" : "secondary"} busy={busy === "whatsapp"} onClick={() => void resend(sent.channel === "sms" ? "sms" : "whatsapp")}>
              Send the code again
            </Button>
          </>
        )}
        <Button kind="quiet" onClick={onChangeNumber}>Change number</Button>
      </div>
    </div>
  );
}
