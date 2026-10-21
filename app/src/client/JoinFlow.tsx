"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, say } from "./api";
import { Button, CityLine, Frame, goToLanding, SanghLogo, Title } from "./ui";
import { FindStep } from "./steps/FindStep";
import { OtpStep, PhoneStep, type Sent } from "./steps/PhoneSteps";
import type { ApiError, SanghCard, VerifyOtpResponse } from "@/lib/api-types";

type Step =
  | { name: "find" }
  | { name: "confirm"; sangh: SanghCard }
  | { name: "phone"; sangh: SanghCard; phone?: string }
  | { name: "otp"; sangh: SanghCard; sent: Sent }
  | { name: "other"; sangh: SanghCard; theirs: SanghCard };

/** Join: find the pathshala → confirm it → number → code → (who is using it, on /who). */
export function JoinFlow() {
  const router = useRouter();
  const initialCode = useSearchParams().get("code") ?? undefined;
  const [step, setStep] = useState<Step>({ name: "find" });

  const lit = step.name === "find" ? 0 : 1; // the pathshala lamp lights once it is found
  const back =
    step.name === "confirm" ? () => setStep({ name: "find" })
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
          <div className="stack push">
            <Button onClick={() => setStep({ name: "phone", sangh: step.sangh })}>Yes, join this pathshala</Button>
            <Button kind="secondary" onClick={() => setStep({ name: "find" })}>No, go back</Button>
          </div>
        </div>
      )}

      {step.name === "phone" && (
        <PhoneStep
          initialPhone={step.phone}
          title={{ en: "Your mobile number", hi: "आपका मोबाइल नंबर", lead: `We'll send a code to check it's yours. One number joins one pathshala.` }}
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
            const e = r.err as ApiError;
            if (e.error === "other_sangh" && e.sangh) { setStep({ name: "other", sangh: step.sangh, theirs: e.sangh }); return null; }
            return say(r.err);
          }}
        />
      )}

      {step.name === "other" && (
        <div className="screen">
          <Title en={`This number is already in ${step.theirs.name}`} hi={`यह नंबर पहले से ${step.theirs.name} में है`} lead="One number can belong to only one pathshala." />
          <div className="card sangh-card mt-5">
            <SanghLogo name={step.theirs.name} url={step.theirs.logoUrl} />
            <h2>{step.theirs.name}</h2>
            <CityLine city={step.theirs.city} />
          </div>
          <p className="hint mt-4">To move to {step.sangh.name}, ask an admin of {step.theirs.name} to remove your number first.</p>
          <div className="stack push">
            <Button onClick={() => router.push("/who")}>Log in to {step.theirs.name}</Button>
            <Button kind="secondary" onClick={async () => { await api("/api/session/logout", { body: {} }); setStep({ name: "phone", sangh: step.sangh }); }}>
              Use a different number
            </Button>
          </div>
        </div>
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
