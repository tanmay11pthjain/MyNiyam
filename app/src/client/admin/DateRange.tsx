"use client";
import { useState } from "react";

// Pick the dates for a report or the leaderboard: a few ready choices, or any two dates.

export type Range = { from: string; to: string; label: string };
type Preset = "week" | "lastweek" | "month" | "lastmonth" | "30" | "custom";

const add = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const monday = (d: string) => add(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));
const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
export const shortDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

/** The dates for a ready choice, ending today at the latest. */
export function presetRange(p: Exclude<Preset, "custom">, today: string): Range {
  switch (p) {
    case "week": return { from: monday(today), to: today, label: "This week" };
    case "lastweek": { const m = add(monday(today), -7); return { from: m, to: add(m, 6), label: "Last week" }; }
    case "month": return { from: monthStart(today), to: today, label: "This month" };
    case "lastmonth": { const end = add(monthStart(today), -1); return { from: monthStart(end), to: end, label: "Last month" }; }
    case "30": return { from: add(today, -29), to: today, label: "Last 30 days" };
  }
}

const CHOICES: { p: Preset; t: string }[] = [
  { p: "week", t: "This week" }, { p: "lastweek", t: "Last week" }, { p: "month", t: "This month" },
  { p: "lastmonth", t: "Last month" }, { p: "30", t: "Last 30 days" }, { p: "custom", t: "Choose dates" },
];

/** Chips for the ready choices; "Choose dates" shows From and To. onChange gets null while the dates are wrong. */
export function DateRangePicker({ today, initial, onChange }: { today: string; initial: Exclude<Preset, "custom">; onChange: (r: Range | null) => void }) {
  const [p, setP] = useState<Preset>(initial);
  const first = presetRange(initial, today);
  const [from, setFrom] = useState(first.from);
  const [to, setTo] = useState(first.to);
  const bad = p === "custom" && (!from || !to || from > to || to > today || (Date.parse(to) - Date.parse(from)) / 864e5 >= 366);
  const custom = (f: string, t: string) => {
    setFrom(f); setTo(t);
    const ok = f && t && f <= t && t <= today && (Date.parse(t) - Date.parse(f)) / 864e5 < 366;
    onChange(ok ? { from: f, to: t, label: `${shortDay(f)} to ${shortDay(t)}` } : null);
  };
  return (
    <div className="stack">
      <div className="chips" role="group" aria-label="Dates">
        {CHOICES.map((c) => (
          <button key={c.p} type="button" className="chip" aria-pressed={p === c.p} onClick={() => {
            setP(c.p);
            if (c.p !== "custom") { const r = presetRange(c.p, today); setFrom(r.from); setTo(r.to); onChange(r); } else custom(from, to);
          }}>{c.t}</button>
        ))}
      </div>
      {p === "custom" && (
        <div className="date-pair">
          <div className="field"><label className="label" htmlFor="dr-from">From</label>
            <input id="dr-from" className="input" type="date" max={today} value={from} onChange={(e) => custom(e.target.value, to)} /></div>
          <div className="field"><label className="label" htmlFor="dr-to">To</label>
            <input id="dr-to" className="input" type="date" max={today} value={to} onChange={(e) => custom(from, e.target.value)} /></div>
        </div>
      )}
      {bad && <p className="msg err" role="alert">Pick a From date on or before the To date, up to today, and at most one year apart.</p>}
    </div>
  );
}
