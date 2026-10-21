"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, say } from "./api";
import { applyPatch, NiyamCard, type LogPatch } from "./NiyamCard";
import { Button } from "./ui";
import type { DayNiyam, DayView, TodayResponse } from "@/lib/today-types";

type Words = { en: string; hi: string };

export const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

const anyDone = (d: DayView) => d.niyams.some((n) => n.done);

/** The home tab: today's niyams, a progress bar and the streak. Yesterday is changed from History. */
export function TodayTab() {
  const [data, setData] = useState<TodayResponse | null>(null);
  const [err, setErr] = useState<Words | null>(null);
  const [toast, setToast] = useState<Words | null>(null);
  const dataRef = useRef<TodayResponse | null>(null);
  useEffect(() => { dataRef.current = data; }, [data]);
  const pending = useRef(new Map<string, { n: number; chain: Promise<unknown> }>());

  const load = useCallback(async () => {
    const r = await api<TodayResponse>("/api/today");
    if (r.ok) { setData(r.data); setErr(null); } else setErr(say(r.err));
  }, []);
  useEffect(() => {
    let live = true;
    void api<TodayResponse>("/api/today").then((r) => { if (!live) return; if (r.ok) setData(r.data); else setErr(say(r.err)); });
    return () => { live = false; };
  }, []);

  if (err && !data) {
    return <div className="banner err"><span>{err.en}</span><Button kind="secondary" onClick={() => { setErr(null); void load(); }}>Try again</Button></div>;
  }
  if (!data) return <div className="stack" aria-busy="true"><div className="skel" /><div className="skel" /><div className="skel" /></div>;

  const day = data.today;

  function setNiyam(n: DayNiyam) {
    setData((d) => d && { ...d, today: { ...d.today, niyams: d.today.niyams.map((x) => (x.id === n.id ? n : x)) } });
  }

  /** Shows the change at once, then saves in order per niyam so quick taps land in the order they were made. */
  function log(n: DayNiyam, patch: LogPatch) {
    const before = anyDone(data!.today);
    setNiyam(applyPatch(n, patch));
    const slot = pending.current.get(n.id) ?? { n: 0, chain: Promise.resolve() };
    slot.n += 1;
    pending.current.set(n.id, slot);
    slot.chain = slot.chain.then(async () => {
      const r = await api<{ niyam: DayNiyam }>("/api/log", { body: { niyamId: n.id, date: day.date, ...patch } });
      slot.n -= 1;
      if (!r.ok) { setToast(say(r.err)); if (slot.n === 0) void load(); return; }
      if (slot.n === 0) {
        setNiyam(r.data.niyam);
        // The streak moves only when the day goes from nothing done to something done (or back).
        const d = dataRef.current;
        if (d && anyDone(d.today) !== before) void load();
      }
    });
  }

  const core = day.niyams.filter((n) => n.isCore);
  const counted = core.length ? core : day.niyams;
  const doneCount = counted.filter((n) => n.done).length;
  const pct = counted.length ? Math.round((doneCount / counted.length) * 100) : 0;
  const allDone = counted.length > 0 && doneCount === counted.length;
  const optional = core.length ? day.niyams.filter((n) => !n.isCore) : [];

  return (
    <div className="stack-lg">
      <section className={`card progress${allDone ? " gold" : ""}`} aria-label="Progress">
        <div className="pr-top">
          <div>
            <p className="pr-day">{dayLabel(day.date)}</p>
            <p className="pr-count"><b>{doneCount}</b> of {counted.length} done</p>
          </div>
          <div className="streak" title="Days in a row with at least one niyam done">
            <svg viewBox="0 0 24 24" aria-hidden="true" className={data.streak > 0 ? "lit" : ""}>
              <path className="flame" d="M12 3c2.2 2.6 3 4.4 3 6.2A3 3 0 0 1 12 12a3 3 0 0 1-3-2.8C9 7.4 9.8 5.6 12 3z" />
              <path className="base" d="M3 14h18c-.6 3.6-4.4 6-9 6s-8.4-2.4-9-6z" />
            </svg>
            <b>{data.streak}</b><span>{data.streak === 1 ? "day" : "days"}</span>
          </div>
        </div>
        <div className="pbar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Today's progress"><i style={{ width: `${pct}%` }} /></div>
        <p className="hint pr-line" role="status">
          {allDone ? "All done. Anumodana!" : data.streak > 0 ? "Keep the lamp lit." : "Log one niyam to start your streak."}
        </p>
      </section>

      {day.niyams.length === 0 ? (
        <div className="card">
          <p><b>No niyams for today.</b></p>
          <p className="hint mt-4">Your pathshala is setting up niyams, or none are planned today. <span lang="hi">आपकी पाठशाला नियम तैयार कर रही है।</span></p>
        </div>
      ) : (
        <>
          <div className="stack">
            {(core.length ? core : day.niyams).map((n) => <NiyamCard key={n.id} n={n} locked={!day.editable} onLog={(p) => log(n, p)} />)}
          </div>
          {optional.length > 0 && (
            <div className="stack">
              <p className="label">Optional</p>
              {optional.map((n) => <NiyamCard key={n.id} n={n} locked={!day.editable} onLog={(p) => log(n, p)} />)}
            </div>
          )}
        </>
      )}

      {toast && (
        <div className="toast" role="alert">
          {toast.en}{" "}
          <button type="button" className="toast-x" onClick={() => setToast(null)}>OK</button>
        </div>
      )}
    </div>
  );
}
