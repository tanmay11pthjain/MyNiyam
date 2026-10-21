"use client";
import { useEffect, useRef, useState } from "react";
import { api, say } from "./api";
import { applyPatch, NiyamCard, type LogPatch } from "./NiyamCard";
import { dayLabel } from "./TodayTab";
import { Button } from "./ui";
import type { DayNiyam, HistoryDayResponse, HistoryResponse } from "@/lib/today-types";

const monthName = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
const shift = (m: string, by: number) => {
  const d = new Date(`${m}-01T00:00:00`);
  d.setMonth(d.getMonth() + by);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/** The current month day by day, newest first. Tap a day to see what was kept; yesterday can still be changed. */
export function HistoryTab() {
  const [month, setMonth] = useState(() => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }).slice(0, 7));
  // The answer is kept with its month, so changing month shows the loading state without setting state in an effect.
  const [res, setRes] = useState<{ month: string; data?: HistoryResponse; err?: string } | null>(null);
  const [tick, setTick] = useState(0);
  const data = res?.month === month ? res.data ?? null : null;
  const err = res?.month === month ? res.err ?? null : null;
  const [openDate, setOpenDate] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void api<HistoryResponse>(`/api/history?month=${month}`).then((r) => {
      if (live) setRes(r.ok ? { month, data: r.data } : { month, err: say(r.err).en });
    });
    return () => { live = false; };
  }, [month, tick]);

  const atFirst = data ? month <= data.firstMonth : true;
  const atLast = data ? month >= data.today.slice(0, 7) : true;

  return (
    <div className="stack-lg">
      <div className="monthbar">
        <button type="button" aria-label="Previous month" disabled={atFirst} onClick={() => { setOpenDate(null); setMonth(shift(month, -1)); }}>‹</button>
        <h2 aria-live="polite">{monthName(month)}</h2>
        <button type="button" aria-label="Next month" disabled={atLast} onClick={() => { setOpenDate(null); setMonth(shift(month, 1)); }}>›</button>
      </div>

      {err && <div className="banner err"><span>{err}</span><Button kind="secondary" onClick={() => { setRes(null); setTick((x) => x + 1); }}>Try again</Button></div>}
      {!data && !err && <div className="stack" aria-busy="true"><div className="skel" /><div className="skel" /></div>}
      {data && data.days.length === 0 && <div className="card"><p><b>Nothing here yet.</b></p><p className="hint mt-4">Days appear after you start.</p></div>}

      {data && data.days.length > 0 && (
        <ul className="days">
          {data.days.map((d) => {
            const full = d.coreTotal > 0 ? d.coreDone >= d.coreTotal : d.anyDone > 0;
            const some = !full && d.anyDone > 0;
            return (
              <li key={d.date}>
                <button type="button" className="dayrow" aria-haspopup="dialog" onClick={() => setOpenDate(d.date)}>
                  <span className={`dot${full ? " full" : some ? " some" : ""}`} aria-hidden="true" />
                  <span className="grow">
                    <span className="t">{dayLabel(d.date)}{d.date === data.today && " · Today"}</span>
                  </span>
                  <span className="s">{d.coreTotal > 0 ? `${d.coreDone} of ${d.coreTotal}` : d.anyDone > 0 ? `${d.anyDone} done` : "No niyams"}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {openDate && <DayDialog date={openDate} onClose={() => setOpenDate(null)} onChanged={() => setTick((x) => x + 1)} />}
    </div>
  );
}

/** One day in a pop-up. Only yesterday can be changed here; today is logged on the Today tab. */
function DayDialog({ date, onClose, onChanged }: { date: string; onClose: () => void; onChanged: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  const [res, setRes] = useState<HistoryDayResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    void api<HistoryDayResponse>(`/api/history?date=${date}`).then((r) => { if (r.ok) setRes(r.data); else setErr(say(r.err).en); });
  }, [date]);

  const canEdit = !!res && res.isYesterday && res.day.editable;

  function log(n: DayNiyam, patch: LogPatch) {
    setRes((r) => r && { ...r, day: { ...r.day, niyams: r.day.niyams.map((x) => (x.id === n.id ? applyPatch(x, patch) : x)) } });
    chain.current = chain.current.then(async () => {
      const r = await api<{ niyam: DayNiyam }>("/api/log", { body: { niyamId: n.id, date, ...patch } });
      if (!r.ok) setErr(say(r.err).en);
      onChanged();
    });
  }

  return (
    <dialog ref={ref} className="sheet" aria-labelledby="day-title" onClose={onClose} onClick={(e) => { if (e.target === e.currentTarget) ref.current?.close(); }}>
      <div className="sheet-head">
        <div>
          <h2 id="day-title">{dayLabel(date)}</h2>
          {res && <p className="hint">{canEdit ? "You can still change yesterday." : res.isYesterday ? "This day has closed." : "Only yesterday can be changed. Log today on the Today tab."}</p>}
        </div>
        <button type="button" className="sheet-x" aria-label="Close" onClick={() => ref.current?.close()}>×</button>
      </div>
      <div className="stack">
        {err && <p className="msg err" role="alert">{err}</p>}
        {!res && !err && <><div className="skel" aria-busy="true" /><div className="skel" /></>}
        {res && res.day.niyams.length === 0 && <p className="hint">No niyams were planned this day.</p>}
        {res?.day.niyams.map((n) => <NiyamCard key={n.id} n={n} locked={!canEdit} onLog={(p) => log(n, p)} />)}
      </div>
      <div className="mt-5"><Button kind="secondary" onClick={() => ref.current?.close()}>Close</Button></div>
    </dialog>
  );
}
