"use client";
import { useEffect, useState } from "react";
import { api, say } from "./api";
import { Switch } from "./admin/kit";
import { Button } from "./ui";

// Reminders on this phone (web push): an evening nudge if nothing is logged yet, and an optional
// "Chauvihar in 30 minutes". At most 2 a day. On iPhone this works only from the home-screen app.

type Status = { enabled: boolean; publicKey: string | null; settings: { remindAt: string; chauvihar: boolean } | null };
type Words = { en: string; hi: string };

const TIMES = ["18:00", "18:30", "19:00", "19:30", "20:00", "20:30", "21:00", "21:30", "22:00"];
const label = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return `${h > 12 ? h - 12 : h}:${String(m).padStart(2, "0")} pm`;
};

export const isIos = () => typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
export const isStandalone = () => typeof window !== "undefined" &&
  (window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);

function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const s = atob((base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  try {
    await navigator.serviceWorker.register("/sw.js");
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

export function Reminders() {
  const [status, setStatus] = useState<Status | null>(null);
  const [sub, setSub] = useState<PushSubscription | null>(null);
  const [remindAt, setRemindAt] = useState("20:00");
  const [chauvihar, setChauvihar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Words | null>(null);
  const supported = typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;

  useEffect(() => {
    let live = true;
    void (async () => {
      const reg = supported ? await navigator.serviceWorker.getRegistration() : undefined;
      const existing = reg ? await reg.pushManager.getSubscription() : null;
      const r = await api<Status>(`/api/push${existing ? `?endpoint=${encodeURIComponent(existing.endpoint)}` : ""}`);
      if (!live || !r.ok) return;
      setStatus(r.data);
      if (existing && r.data.settings) {
        setSub(existing); setRemindAt(r.data.settings.remindAt); setChauvihar(r.data.settings.chauvihar);
      }
    })();
    return () => { live = false; };
  }, [supported]);

  if (!status || !status.enabled) return null; // not switched on for MyNiyam yet: say nothing

  async function save(next: { remindAt: string; chauvihar: boolean }, current: PushSubscription | null = sub) {
    setBusy(true); setMsg(null);
    try {
      let s = current;
      if (!s) {
        if ((await Notification.requestPermission()) !== "granted") {
          setMsg({ en: "Notifications are blocked. Allow them for MyNiyam in your phone's settings, then try again.", hi: "सूचनाएँ बंद हैं। फ़ोन की सेटिंग में MyNiyam के लिए चालू करें।" });
          return;
        }
        const reg = await registration();
        if (!reg) { setMsg({ en: "This browser can't show reminders.", hi: "इस ब्राउज़र में रिमाइंडर नहीं चल सकते।" }); return; }
        s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(status!.publicKey!) });
      }
      const r = await api("/api/push", { body: { subscription: s.toJSON(), ...next } });
      if (!r.ok) { setMsg(say(r.err)); return; }
      setSub(s); setRemindAt(next.remindAt); setChauvihar(next.chauvihar);
      setMsg({ en: "Saved.", hi: "सेव हो गया।" });
    } catch {
      setMsg({ en: "Couldn't turn on reminders on this phone.", hi: "इस फ़ोन पर रिमाइंडर चालू नहीं हो सके।" });
    } finally {
      setBusy(false);
    }
  }

  async function off() {
    if (!sub) return;
    setBusy(true);
    await api("/api/push", { method: "DELETE", body: { endpoint: sub.endpoint } });
    await sub.unsubscribe().catch(() => {});
    setSub(null); setBusy(false); setMsg(null);
  }

  const needsInstall = isIos() && !isStandalone();

  return (
    <section className="card stack" aria-labelledby="rem-h">
      <h2 id="rem-h" className="sec-h">Reminders <span className="hi" lang="hi">याद दिलाना</span></h2>
      {!supported || needsInstall ? (
        <p className="hint">
          {needsInstall
            ? "On iPhone, reminders work after you add MyNiyam to your Home Screen: tap Share, then “Add to Home Screen”, and open it from there."
            : "This browser can't show reminders. Open MyNiyam in Chrome to get them."}
        </p>
      ) : !sub ? (
        <>
          <p className="hint">A gentle reminder in the evening, only on days you haven&apos;t logged yet. Never more than 2 a day.</p>
          <div className="field">
            <label className="label" htmlFor="rem-at">Remind me at</label>
            <select id="rem-at" className="input" value={remindAt} onChange={(e) => setRemindAt(e.target.value)}>
              {TIMES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
            </select>
          </div>
          <Button busy={busy} onClick={() => void save({ remindAt, chauvihar })}>Turn on reminders</Button>
        </>
      ) : (
        <>
          <div className="field">
            <label className="label" htmlFor="rem-at">Evening reminder at</label>
            <select id="rem-at" className="input" value={remindAt} disabled={busy} onChange={(e) => void save({ remindAt: e.target.value, chauvihar })}>
              {TIMES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
            </select>
          </div>
          <div className="list">
            <Switch label="Chauvihar reminder · चौविहार" sub="30 minutes before sunset at your pathshala." checked={chauvihar} busy={busy}
              onChange={(v) => void save({ remindAt, chauvihar: v })} />
          </div>
          <Button kind="quiet" busy={busy} onClick={() => void off()}>Turn off reminders on this phone</Button>
        </>
      )}
      {msg && <p className="msg ok" role="status">{msg.en} <span lang="hi">{msg.hi}</span></p>}
    </section>
  );
}
