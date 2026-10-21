"use client";
import { useState } from "react";
import { NiyamIcon } from "./admin/icons";
import type { DayNiyam, LogInput } from "@/lib/today-types";

export type LogPatch = Pick<LogInput, "done" | "value" | "choice">;

/** What the card shows right after a tap, before the server answers. */
export function applyPatch(n: DayNiyam, p: LogPatch): DayNiyam {
  if (n.type === "yesno") return { ...n, done: p.done !== false };
  if (n.type === "choice") return { ...n, choice: p.choice ?? null, done: !!p.choice };
  const value = p.value ?? 0;
  return { ...n, value, done: value > 0 && value >= (n.target ?? 1) };
}

/** 0 to 1: how far along this niyam is today. A count of 54 out of 108 is half. */
export function progressOf(n: DayNiyam): number {
  if (n.done) return 1;
  if ((n.type === "count" || n.type === "duration") && n.target) return Math.min(1, n.value / n.target);
  return 0;
}

const Tick = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);

/**
 * One niyam. Yes/no: the whole card is the button. Count and minutes: a big +1 (or +5) with Done as a shortcut.
 * Choice: tap to open the options. `locked` shows the day as read-only.
 */
export function NiyamCard({ n, locked, onLog }: { n: DayNiyam; locked: boolean; onLog: (p: LogPatch) => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(false);
  const unit = n.type === "duration" ? " min" : "";
  const step = n.type === "duration" ? 5 : 1;
  const names = (
    <>
      <span className="nc-name">{n.name}</span>
      {n.nameHi && <span className="nc-hi hi" lang="hi">{n.nameHi}</span>}
    </>
  );
  const infoBtn = n.note ? (
    <button type="button" className="nc-info" aria-expanded={note} aria-label={`About ${n.name}`} onClick={() => setNote(!note)}>i</button>
  ) : null;

  return (
    <article className={`ncard${n.done ? " done" : ""}`}>
      {n.type === "yesno" ? (
        <button type="button" className="nc-row nc-tap" role="switch" aria-checked={n.done} disabled={locked} onClick={() => onLog({ done: !n.done })}>
          <span className="nc-icon"><NiyamIcon name={n.icon} /></span>
          <span className="nc-names">{names}</span>
          <span className="nc-check" aria-hidden="true"><Tick /></span>
        </button>
      ) : (
        <div className="nc-row">
          <span className="nc-icon"><NiyamIcon name={n.icon} /></span>
          <span className="nc-names">{names}</span>
          <span className="nc-check" aria-hidden="true"><Tick /></span>
        </div>
      )}

      {(n.type === "count" || n.type === "duration") && (
        <div className="nc-controls">
          <button type="button" className="nc-minus" aria-label={`One less ${n.name}`} disabled={locked || n.value <= 0}
            onClick={() => onLog({ value: Math.max(0, n.value - step) })}>−</button>
          <span className="nc-count" aria-live="polite"><b>{n.value}</b> / {n.target}{unit}</span>
          <button type="button" className="nc-plus" disabled={locked} onClick={() => onLog({ value: n.value + step })}>+{step}{unit}</button>
          {!n.done && <button type="button" className="nc-fill" disabled={locked} onClick={() => onLog({ value: n.target ?? 1 })}>Done</button>}
        </div>
      )}

      {n.type === "choice" && (
        <div className="nc-controls">
          <button type="button" className="nc-choose" aria-expanded={open} disabled={locked} onClick={() => setOpen(!open)}>
            {n.choice ? (n.options.find((o) => o.value === n.choice)?.en ?? n.choice) : "Choose one"}
          </button>
        </div>
      )}
      {n.type === "choice" && open && !locked && (
        <div className="chips nc-options" role="group" aria-label={n.name}>
          {n.options.map((o) => (
            <button key={o.value} type="button" className="chip" aria-pressed={n.choice === o.value}
              onClick={() => { onLog({ choice: n.choice === o.value ? null : o.value }); setOpen(false); }}>
              {o.en}{o.hi && <span className="hi" lang="hi"> {o.hi}</span>}
            </button>
          ))}
        </div>
      )}
      {infoBtn}
      {note && n.note && <p className="nc-note hint">{n.note}</p>}
    </article>
  );
}
