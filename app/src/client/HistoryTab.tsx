"use client";
import { useEffect, useRef, useState } from "react";
import { api, say } from "./api";
import { applyPatch, NiyamCard, type LogPatch } from "./NiyamCard";
import { dayLabel } from "./TodayTab";
import { Button } from "./ui";
import type { DayNiyam, HistoryDayResponse, HistoryResponse, NiyamStat } from "@/lib/today-types";

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

      {data?.attendance && <AttendanceCard a={data.attendance} />}

      {data && data.days.length > 0 && <Calendar data={data} onOpen={setOpenDate} />}
      <NiyamStats key={tick} />
      {openDate && <DayDialog date={openDate} onClose={() => setOpenDate(null)} onChanged={() => setTick((x) => x + 1)} />}
    </div>
  );
}

const WEEK = ["S", "M", "T", "W", "T", "F", "S"];

/** The month as a calendar. Gold: every core niyam kept. Half: some kept. A small dot: came to pathshala. */
function Calendar({ data, onOpen }: { data: HistoryResponse; onOpen: (d: string) => void }) {
  const byDate = new Map(data.days.map((d) => [d.date, d]));
  const first = new Date(`${data.month}-01T00:00:00Z`);
  const blanks = first.getUTCDay();
  const dim = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return (
    <div className="cal-wrap">
      <div className="cal" role="grid" aria-label={`${monthName(data.month)} calendar`}>
        {WEEK.map((w, i) => <span key={i} className="cal-h" aria-hidden="true">{w}</span>)}
        {Array.from({ length: blanks }, (_, i) => <span key={`b${i}`} />)}
        {Array.from({ length: dim }, (_, i) => {
          const date = `${data.month}-${String(i + 1).padStart(2, "0")}`;
          const d = byDate.get(date);
          if (!d) return <span key={date} className="cal-d off" aria-hidden="true">{i + 1}</span>;
          const full = d.coreTotal > 0 ? d.coreDone >= d.coreTotal : d.anyDone > 0;
          const some = !full && d.anyDone > 0;
          const words = full ? "all kept" : some ? `${d.anyDone} kept` : "nothing kept";
          return (
            <button key={date} type="button" className={`cal-d${full ? " full" : some ? " some" : ""}${date === data.today ? " today" : ""}`}
              aria-label={`${dayLabel(date)}: ${words}${d.attendance ? `, ${ATT_WORDS[d.attendance].toLowerCase()}` : ""}`} onClick={() => onOpen(date)}>
              {i + 1}
              {d.attendance && <i className={`cal-att ${d.attendance}`} aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      <p className="cal-key" aria-hidden="true"><span className="cal-d full">1</span> All kept <span className="cal-d some">1</span> Some <span className="cal-d">1</span> None</p>
    </div>
  );
}

const ATT_WORDS = { present: "At pathshala", late: "Came late", absent: "Absent" } as const;

/** This month's pathshala attendance, counted from the days a teacher took it. */
function AttendanceCard({ a }: { a: { present: number; late: number; absent: number } }) {
  const came = a.present + a.late, total = came + a.absent;
  return (
    <div className="card att-card">
      <p><b>Pathshala this month</b></p>
      <p className="att-big">{came} of {total} {total === 1 ? "class" : "classes"} <span className="hint">({Math.round((came / total) * 100)}%)</span></p>
      {a.late > 0 && <p className="hint">{a.late} late</p>}
    </div>
  );
}

/** Each niyam: days in a row now, best ever, and the total kept. */
function NiyamStats() {
  const [rows, setRows] = useState<NiyamStat[] | null>(null);
  useEffect(() => { void api<{ niyams: NiyamStat[] }>("/api/history/niyams").then((r) => { if (r.ok) setRows(r.data.niyams); }); }, []);
  if (!rows || rows.length === 0) return null;
  return (
    <section className="stack" aria-labelledby="ns-h">
      <h2 id="ns-h" className="sec-h">My niyams</h2>
      <ul className="days">
        {rows.map((n) => (
          <li key={n.id} className="dayrow ns-row">
            <span className="grow">
              <span className="t">{n.name}</span>
              <span className="s">Best {n.best} {n.best === 1 ? "day" : "days"} in a row · {n.total.toLocaleString("en-IN")} {n.unit}</span>
            </span>
            <span className="ns-streak"><b>{n.streak}</b><span>{n.streak === 1 ? "day" : "days"}</span></span>
          </li>
        ))}
      </ul>
    </section>
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
