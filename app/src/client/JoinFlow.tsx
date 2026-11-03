"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, say } from "./api";
import { Button, CityLine, Frame, goToLanding, Msg, SanghLogo, Title } from "./ui";
import { FindStep } from "./steps/FindStep";
import { OtpStep, PhoneStep, type Sent } from "./steps/PhoneSteps";
import type { Me, SanghCard, VerifyOtpResponse } from "@/lib/api-types";

type Step =
  | { name: "find" }
  | { name: "confirm"; sangh: SanghCard }
  | { name: "phone"; sangh: SanghCard; phone?: string }
  | { name: "otp"; sangh: SanghCard; sent: Sent };

/**
 * Join: pathshala code → confirm it → (number → code, unless this phone is already signed in)
 * → choose who is joining, on /who (everyone on this number, from any pathshala, or someone new).
 */
export function JoinFlow() {
  const router = useRouter();
  const initialCode = useSearchParams().get("code") ?? undefined;
  const [step, setStep] = useState<Step>({ name: "find" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ en: string; hi: string } | null>(null);
  // The number this phone is signed in with, if any: joining then needs no new code.
  const [signedIn, setSignedIn] = useState<string | null>(null);
  useEffect(() => { void api<Me>("/api/me").then((r) => setSignedIn(r.ok ? r.data.phone : null)); }, []);

  // Already signed in on this phone: the number is verified, so join straight away. Otherwise ask for it.
  async function confirm(sangh: SanghCard) {
    setBusy(true); setErr(null);
    const r = await api<VerifyOtpResponse>("/api/join", { body: { sanghId: sangh.id } });
    setBusy(false);
    if (r.ok) { router.push("/who"); return; }
    if (r.err.error === "unauthorized") { setStep({ name: "phone", sangh }); return; }
    setErr(say(r.err));
  }

  const lit = step.name === "find" ? 0 : 1; // the pathshala lamp lights once it is found
  const back =
    step.name === "confirm" ? () => { setErr(null); setStep({ name: "find" }); }
    : step.name === "phone" ? () => setStep({ name: "confirm", sangh: step.sangh })
    : step.name === "otp" ? () => setStep({ name: "phone", sangh: step.sangh, phone: step.sent.phone })
    : undefined;

  return (
    <Frame onBack={back} lamps={{ total: 3, lit }}>
      {step.name === "find" && <FindStep initialCode={initialCode} onFound={(sangh) => setStep({ name: "confirm", sangh })} />}

      {step.name === "confirm" && (
        <div className="screen">
          <Title en="Is this your pathshala?" hi="क्या यह आपकी पाठशाला है?" />
          <div className="card sangh-card mt-5">
            <SanghLogo name={step.sangh.name} url={step.sangh.logoUrl} />
            <h2>{step.sangh.name}</h2>
            <CityLine city={step.sangh.city} />
            <span className="pill">Code {step.sangh.joinCode}</span>
          </div>
          {signedIn && (
            <p className="hint mt-4">You&apos;ll join with your number {signedIn}.{" "}
              <button type="button" className="link-btn" onClick={async () => {
                await api("/api/session/logout", { body: {} });
                setSignedIn(null); setErr(null); setStep({ name: "phone", sangh: step.sangh });
              }}>Use a different number</button>
            </p>
          )}
          <div className="stack push">
            <Msg text={err} />
            <Button busy={busy} onClick={() => void confirm(step.sangh)}>{busy ? "Joining…" : "Yes, join this pathshala"}</Button>
            <Button kind="secondary" onClick={() => { setErr(null); setStep({ name: "find" }); }}>No, go back</Button>
          </div>
        </div>
      )}

      {step.name === "phone" && (
        <PhoneStep
          initialPhone={step.phone}
          title={{ en: "Your mobile number", hi: "आपका मोबाइल नंबर", lead: "We'll send a code to check it's yours. Your whole family can use this one number." }}
          onSent={(sent) => setStep({ name: "otp", sangh: step.sangh, sent })}
        />
      )}

      {step.name === "otp" && (
        <OtpStep
          sent={step.sent}
          onResent={(sent) => setStep({ ...step, sent })}
          onChangeNumber={() => setStep({ name: "phone", sangh: step.sangh })}
          onVerify={async (code) => {
            const r = await api<VerifyOtpResponse>("/api/otp/verify", { body: { intent: "join", phone: step.sent.phone, code, sanghId: step.sangh.id } });
            if (r.ok) { router.push("/who"); return null; }
            if (r.err.error === "pathshala_limit") { setErr(say(r.err)); setStep({ name: "confirm", sangh: step.sangh }); return null; }
            return say(r.err);
          }}
        />
      )}

    </Frame>
  );
}

/** Login for someone who already joined: number → code → /who. */
export function LoginFlow() {
  const router = useRouter();
  const [sent, setSent] = useState<Sent | null>(null);
  const [notMember, setNotMember] = useState(false);
  const [phone, setPhone] = useState<string | undefined>();

  if (notMember) {
    return (
      <Frame onBack={() => { setNotMember(false); setSent(null); }}>
        <div className="screen">
          <Title en="This number hasn't joined yet" hi="यह नंबर अभी किसी पाठशाला में नहीं है" lead="Join your pathshala first. You'll need its code, its QR code or its name." />
          <div className="stack push">
            <Button onClick={() => router.push("/join")}>Join your pathshala</Button>
            <Button kind="secondary" onClick={() => { setNotMember(false); setSent(null); }}>Try another number</Button>
          </div>
        </div>
      </Frame>
    );
  }

  return (
    <Frame onBack={sent ? () => { setPhone(sent.phone); setSent(null); } : () => goToLanding()}>
      {!sent ? (
        <PhoneStep
          initialPhone={phone}
          title={{ en: "Welcome back", hi: "फिर से स्वागत है", lead: "Enter the number you joined with." }}
          onSent={setSent}
        />
      ) : (
        <OtpStep
          sent={sent}
          onResent={setSent}
          onChangeNumber={() => setSent(null)}
          onVerify={async (code) => {
            const r = await api<VerifyOtpResponse>("/api/otp/verify", { body: { intent: "login", phone: sent.phone, code } });
            if (r.ok) { router.push("/who"); return null; }
            if (r.err.error === "not_member") { setNotMember(true); return null; }
            return say(r.err);
          }}
        />
      )}
    </Frame>
  );
}
