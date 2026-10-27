"use client";
import { useState } from "react";
import { api, say } from "./api";
import { Button } from "./ui";
import type { Vow } from "@/lib/today-types";

type Words = { en: string; hi: string };

const shortDay = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const plusDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/**
 * My vows (pachchakkhan) on Today: private to this person, each with an end date. Tap to tick today.
 * They don't count toward the streak or Tej; they are between you and your atma.
 */
export function Vows({ vows, today, onChanged }: { vows: Vow[]; today: string; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [until, setUntil] = useState(() => plusDays(today, 7));
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<Words | null>(null);
  const [local, setLocal] = useState<Record<string, boolean>>({});

  async function tick(v: Vow) {
    const done = !(local[v.id] ?? v.doneToday);
    setLocal((x) => ({ ...x, [v.id]: done }));
    const r = await api(`/api/vows/${v.id}`, { method: "PATCH", body: { date: today, done } });
    if (!r.ok) { setLocal((x) => ({ ...x, [v.id]: !done })); setErr(say(r.err)); }
  }

  async function add() {
    if (!name.trim()) { setErr({ en: "Write your vow.", hi: "अपना संकल्प लिखें।" }); return; }
    setBusy("add"); setErr(null);
    const r = await api("/api/vows", { body: { name: name.trim(), endDate: until } });
    setBusy(null);
    if (!r.ok) { setErr(say(r.err)); return; }
    setName(""); setAdding(false); onChanged();
  }

  async function end(v: Vow) {
    setBusy(v.id);
    const r = await api(`/api/vows/${v.id}`, { method: "PATCH", body: { end: true } });
    setBusy(null);
    if (r.ok) onChanged(); else setErr(say(r.err));
  }

  return (
    <section className="stack" aria-labelledby="vows-h">
      <p className="label" id="vows-h">My vows <span className="hi" lang="hi">मेरे संकल्प</span></p>
      {vows.map((v) => {
        const done = local[v.id] ?? v.doneToday;
        const kept = v.daysKept + (done === v.doneToday ? 0 : done ? 1 : -1);
        return (
          <article key={v.id} className={`ncard vow${done ? " done" : ""}`}>
            <button type="button" className="nc-row nc-tap" role="switch" aria-checked={done} onClick={() => void tick(v)}>
              <span className="nc-icon vow-icon" aria-hidden="true">ॐ</span>
              <span className="nc-names">
                <span className="nc-name">{v.name}</span>
                <span className="nc-time">Until {shortDay(v.endDate)} · kept {kept} {kept === 1 ? "day" : "days"}</span>
              </span>
              <span className="nc-check" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
              </span>
            </button>
            <button type="button" className="vow-end" disabled={busy === v.id} onClick={() => void end(v)}>End this vow</button>
          </article>
        );
      })}
      {adding ? (
        <form className="card stack" noValidate onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <div className="field">
            <label className="label" htmlFor="vow-name">My vow</label>
            <input id="vow-name" className="input" value={name} maxLength={60} placeholder="e.g. No sweets until Diwali" onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="vow-until">Until</label>
            <input id="vow-until" className="input" type="date" value={until} min={today} max={plusDays(today, 366)} onChange={(e) => setUntil(e.target.value)} />
          </div>
          <p className="hint">Only you see your vows.</p>
          <Button type="submit" busy={busy === "add"}>Add vow</Button>
          <Button kind="quiet" onClick={() => { setAdding(false); setErr(null); }}>Cancel</Button>
        </form>
      ) : (
        <Button kind="secondary" onClick={() => setAdding(true)}>+ Add a personal vow</Button>
      )}
      {err && <p className="msg err" role="alert">{err.en} <span lang="hi">{err.hi}</span></p>}
    </section>
  );
}
