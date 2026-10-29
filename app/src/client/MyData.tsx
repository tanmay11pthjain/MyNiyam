"use client";
import { useEffect, useRef, useState } from "react";
import { useBack } from "./back";
import { api, say } from "./api";
import { clearOfflineData } from "./offline";
import { Button } from "./ui";
import { OTP_LENGTH } from "@/lib/otp-code";

type Words = { en: string; hi: string };

/** Profile's "Your data": download a copy, or delete everything on this number after a fresh code. */
export function MyData({ phone, names }: { phone: string; names: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="stack" aria-labelledby="mydata-h">
      <h2 id="mydata-h" className="label">Your data</h2>
      {/* A plain link: the browser saves the file the server sends. */}
      <a className="btn btn-secondary" href="/api/me/data" download>Download my data</a>
      <Button kind="quiet" onClick={() => setOpen(true)}><span style={{ color: "var(--danger)" }}>Delete my data</span></Button>
      {open && <DeleteDialog phone={phone} names={names} onClose={() => setOpen(false)} />}
    </section>
  );
}

function DeleteDialog({ phone, names, onClose }: { phone: string; names: string[]; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  const [step, setStep] = useState<"ask" | "code">("ask");
  const [simulated, setSimulated] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Words | null>(null);

  async function send() {
    setBusy(true); setErr(null);
    const r = await api<{ simulated: boolean }>("/api/me/delete", { body: { step: "send" } });
    setBusy(false);
    if (r.ok) { setSimulated(r.data.simulated); setStep("code"); } else setErr(say(r.err));
  }
  async function confirm(c: string) {
    setBusy(true); setErr(null);
    const r = await api("/api/me/delete", { body: { step: "confirm", code: c } });
    if (r.ok) { clearOfflineData(); window.location.replace("/"); return; }
    setBusy(false); setCode(""); setErr(say(r.err));
  }

  useBack(() => ref.current?.close());

  return (
    <dialog ref={ref} className="sheet" aria-labelledby="del-title" onClose={onClose} onClick={(e) => { if (e.target === e.currentTarget) ref.current?.close(); }}>
      <div className="sheet-head">
        <h2 id="del-title">Delete my data?</h2>
        <button type="button" className="sheet-x" aria-label="Close" onClick={() => ref.current?.close()}>×</button>
      </div>
      <div className="stack">
        {step === "ask" ? (
          <>
            <p>This deletes <b>{phone}</b> and everyone on it{names.length > 1 ? `: ${names.join(", ")}` : ""}, with all their niyam logs.</p>
            <p><b>It happens at once and cannot be undone.</b> Streaks and history are lost. You can join again later as new.</p>
            <p className="hint" lang="hi">यह नंबर, इस पर जुड़े सभी लोग और उनके सारे नियम तुरंत मिट जाएँगे। वापस नहीं आएँगे।</p>
            {err && <p className="msg err" role="alert">{err.en}</p>}
            <Button kind="danger" busy={busy} onClick={send}>Send me a code to confirm</Button>
          </>
        ) : (
          <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); void confirm(code); }}>
            <p>{simulated ? "Practice mode: no message is sent. The code is 1234." : `Enter the ${OTP_LENGTH}-digit code we just sent to ${phone}.`}</p>
            <label className="label sr-only" htmlFor="del-otp">{OTP_LENGTH}-digit code</label>
            <input id="del-otp" className="input otp-input" inputMode="numeric" autoComplete="one-time-code" maxLength={OTP_LENGTH}
              placeholder={"•".repeat(OTP_LENGTH)} value={code} autoFocus
              onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH); setCode(v); setErr(null); }} />
            {err && <p className="msg err" role="alert">{err.en}</p>}
            <Button type="submit" kind="danger" busy={busy} disabled={code.length !== OTP_LENGTH}>Delete everything now</Button>
          </form>
        )}
        <Button kind="secondary" onClick={() => ref.current?.close()}>Keep my data</Button>
      </div>
    </dialog>
  );
}
