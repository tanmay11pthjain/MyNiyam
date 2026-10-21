"use client";
import { useState } from "react";
import { api, say } from "../api";
import { Frame } from "../ui";
import { OtpStep, PhoneStep, type Sent } from "../steps/PhoneSteps";

/** Admin log-in: the same phone + OTP as members, then into /admin. */
export function AdminLogin() {
  const [sent, setSent] = useState<Sent | null>(null);
  const [phone, setPhone] = useState<string | undefined>();
  return (
    <Frame onBack={sent ? () => { setPhone(sent.phone); setSent(null); } : undefined}>
      {!sent ? (
        <PhoneStep
          initialPhone={phone}
          title={{ en: "Pathshala admin", hi: "पाठशाला एडमिन", lead: "Log in with the mobile number MyNiyam has as your pathshala's admin." }}
          onSent={setSent}
          forAdmin
        />
      ) : (
        <OtpStep
          sent={sent}
          onResent={setSent}
          onChangeNumber={() => setSent(null)}
          onVerify={async (code) => {
            const r = await api("/api/admin/session", { body: { phone: sent.phone, code } });
            if (r.ok) { window.location.replace("/admin"); return null; }
            return say(r.err);
          }}
        />
      )}
    </Frame>
  );
}
