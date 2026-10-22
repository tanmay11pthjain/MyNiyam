"use client";
import { useState } from "react";
import { api } from "../api";
import { Button } from "../ui";
import { useAdmin } from "./AdminApp";
import { Confirm, LoadError, Loading, Sheet, sayAdmin, useLoad, useToast } from "./kit";
import type { AttendanceMonth, AttendanceSheet } from "@/lib/admin-types";

type Status = "present" | "late" | "absent";
// One tap moves to the next: present → absent → late → present.
const NEXT: Record<Status, Status> = { present: "absent", absent: "late", late: "present" };
const WORD: Record<Status, string> = { present: "Present", absent: "Absent", late: "Late" };

const FULL_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const dayName = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
const shiftMonth = (m: string, n: number) => { const [y, mo] = m.split("-").map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

/** Take attendance for a class (present by default, tap to change), and see the month. */
export function AttendancePage() {
  const { sangh, can } = useAdmin();
  const [view, setView] = useState<"day" | "month">("day");
  const [cls, setCls] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const q = new URLSearchParams({ s: sangh.id, ...(cls ? { class: cls } : {}), ...(day ? { day } : {}) });
  const d = useLoad<AttendanceSheet>(can("attendance") ? `/api/admin/attendance?${q}` : null);

  if (!can("attendance")) return <main className="page"><div className="banner err">You can&apos;t take attendance in this pathshala.</div></main>;
  if (d.state === "loading") return <div className="page"><Loading rows={5} /></div>;
  if (d.state === "error") return <div className="page"><LoadError message={d.message} retry={d.retry} /></div>;
  const s = d.data;

  if (!s.classId) {
    return (
      <main className="page">
        <div className="page-title"><h1 data-hi="हाज़िरी">Attendance</h1></div>
        <div className="notice"><b>No classes yet</b><span>{can("setup") ? "Add classes in Setup first. Attendance is taken class by class." : "Ask the admin to give you a class."}</span></div>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="page-title"><h1 data-hi="हाज़िरी">Attendance</h1></div>
      <div className="seg" role="group" aria-label="View">
        <button type="button" className="chip" aria-pressed={view === "day"} onClick={() => setView("day")}>Take attendance</button>
        <button type="button" className="chip" aria-pressed={view === "month"} onClick={() => setView("month")}>Month report</button>
      </div>
      {s.classes.length > 1 && (
        <div className="chips" aria-label="Class">
          {s.classes.map((c) => <button key={c.id} type="button" className="chip" aria-pressed={c.id === s.classId} onClick={() => setCls(c.id)}>{c.name}</button>)}
        </div>
      )}
      {view === "day"
        ? <DayView key={`${s.classId}-${s.day}`} s={s} onDay={setDay} onSaved={d.set} admin={can("admin")} />
        : <MonthView classId={s.classId} sanghId={sangh.id} today={s.today} />}
    </main>
  );
}

function DayView({ s, onDay, onSaved, admin }: { s: AttendanceSheet; onDay: (d: string) => void; onSaved: (s: AttendanceSheet) => void; admin: boolean }) {
  const toast = useToast();
  const cls = s.classes.find((c) => c.id === s.classId)!;
  // Not taken yet: everyone starts as present, so the teacher only taps the few who aren't.
  const [marks, setMarks] = useState<Record<string, Status>>(() => Object.fromEntries(s.people.map((p) => [p.id, p.status ?? "present"])));
  const [dirty, setDirty] = useState(!s.taken);
  const [busy, setBusy] = useState(false);
  const [holiday, setHoliday] = useState(false);
  const [clear, setClear] = useState(false);
  const counts = { present: 0, late: 0, absent: 0 };
  for (const p of s.people) counts[marks[p.id]]++;
  const offDay = cls.meetsOn.length > 0 && !cls.meetsOn.includes(weekday(s.day));

  async function save() {
    setBusy(true);
    const r = await api<AttendanceSheet>("/api/admin/attendance", { method: "PUT", body: { classId: s.classId, day: s.day, marks: s.people.map((p) => ({ profileId: p.id, status: marks[p.id] })) } });
    setBusy(false);
    if (r.ok) { onSaved(r.data); setDirty(false); toast(`Saved: ${counts.present + counts.late} of ${s.people.length} came`); } else toast(sayAdmin(r.err));
  }

  return (
    <>
      <div className="monthbar">
        <button type="button" aria-label="Day before" disabled={s.day <= s.minDay} onClick={() => onDay(addDays(s.day, -1))}>‹</button>
        <h2 aria-live="polite">{s.day === s.today ? "Today, " : ""}{dayName(s.day)}</h2>
        <button type="button" aria-label="Next day" disabled={s.day >= s.today} onClick={() => onDay(addDays(s.day, 1))}>›</button>
      </div>

      {s.holiday ? (
        <div className="notice">
          <b>Holiday{s.holiday.note ? `: ${s.holiday.note}` : ""}</b>
          <span>No class today. It doesn&apos;t count against anyone.</span>
          {admin && <Button kind="secondary" onClick={async () => {
            const r = await api<AttendanceSheet>("/api/admin/attendance/holiday", { body: { classId: s.classId, day: s.day, holiday: false } });
            if (r.ok) { onSaved(r.data); toast("Holiday removed"); } else toast(sayAdmin(r.err));
          }}>Remove holiday</Button>}
        </div>
      ) : (
        <>
          {offDay && <p className="hint">{cls.name} doesn&apos;t usually meet on {FULL_DAYS[weekday(s.day)]}. You can still take attendance.</p>}
          {s.people.length === 0 ? (
            <div className="notice"><b>No one in {cls.name} yet</b><span>Members appear here once they join this class.</span></div>
          ) : (
            <>
              <p className="att-sum" aria-live="polite"><b>{counts.present}</b> present · <b>{counts.absent}</b> absent · <b>{counts.late}</b> late</p>
              <p className="hint">Tap a name to change it: present, absent, late.</p>
              <div className="list">
                {s.people.map((p) => (
                  <button key={p.id} type="button" className="row att-row" aria-label={`${p.name}: ${WORD[marks[p.id]]}. Tap to change.`}
                    onClick={() => { setMarks((m) => ({ ...m, [p.id]: NEXT[m[p.id]] })); setDirty(true); }}>
                    <span className="grow"><span className="t">{p.name}</span></span>
                    <span className={`att-pill ${marks[p.id]}`}>{WORD[marks[p.id]]}</span>
                  </button>
                ))}
              </div>
              {dirty || !s.taken
                ? <Button busy={busy} onClick={() => void save()}>{busy ? "Saving…" : s.taken ? "Save changes" : "Save attendance"}</Button>
                : <p className="msg ok" role="status">Attendance saved for this day.</p>}
              {s.taken && <Button kind="quiet" onClick={() => setClear(true)}>Clear this day</Button>}
            </>
          )}
          {admin && <Button kind="quiet" onClick={() => setHoliday(true)}>Mark {s.day === s.today ? "today" : "this day"} as a holiday</Button>}
        </>
      )}

      {holiday && <HolidaySheet s={s} onClose={() => setHoliday(false)} onSaved={(x) => { setHoliday(false); onSaved(x); toast("Marked as a holiday"); }} />}
      {clear && (
        <Confirm title="Clear this day?" action="Clear attendance" onClose={() => setClear(false)}
          body={<p>The marks for {cls.name} on {dayName(s.day)} are removed. You can take it again.</p>}
          onConfirm={async () => {
            const r = await api<AttendanceSheet>("/api/admin/attendance", { method: "DELETE", body: { classId: s.classId, day: s.day } });
            if (!r.ok) return sayAdmin(r.err);
            setClear(false); setDirty(true); onSaved(r.data); toast("Cleared");
            return null;
          }} />
      )}
    </>
  );
}

function HolidaySheet({ s, onClose, onSaved }: { s: AttendanceSheet; onClose: () => void; onSaved: (s: AttendanceSheet) => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Sheet title={`Holiday on ${dayName(s.day)}`} onClose={onClose}>
      <form className="stack" noValidate onSubmit={async (e) => {
        e.preventDefault(); setBusy(true);
        const r = await api<AttendanceSheet>("/api/admin/attendance/holiday", { body: { classId: s.classId, day: s.day, holiday: true, note: note.trim() || null } });
        setBusy(false);
        if (r.ok) onSaved(r.data); else setErr(sayAdmin(r.err));
      }}>
        <p>For the whole pathshala: no class in any class that day, and it never counts against anyone.</p>
        <div className="field"><label className="label" htmlFor="hn">Reason <span className="opt">(optional)</span></label>
          <input id="hn" className="input" maxLength={80} placeholder="e.g. Paryushan, Diwali" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        {err && <p className="msg err" role="alert">{err}</p>}
        <Button type="submit" busy={busy}>{busy ? "Saving…" : "Mark as holiday"}</Button>
      </form>
    </Sheet>
  );
}

function MonthView({ classId, sanghId, today }: { classId: string; sanghId: string; today: string }) {
  const [month, setMonth] = useState(today.slice(0, 7));
  const d = useLoad<AttendanceMonth>(`/api/admin/attendance/month?s=${sanghId}&class=${classId}&month=${month}`);
  return (
    <>
      <div className="monthbar">
        <button type="button" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
        <h2 aria-live="polite">{monthName(month)}</h2>
        <button type="button" aria-label="Next month" disabled={month >= today.slice(0, 7)} onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
      </div>
      {d.state === "loading" && <Loading rows={4} />}
      {d.state === "error" && <LoadError message={d.message} retry={d.retry} />}
      {d.state === "ready" && (d.data.days.length === 0 ? (
        <div className="notice"><b>No attendance this month</b><span>Days you take attendance for {d.data.className} show up here.</span></div>
      ) : (
        <>
          <p className="att-sum">{d.data.days.length} {d.data.days.length === 1 ? "class" : "classes"} taken{d.data.holidays.length ? ` · ${d.data.holidays.length} ${d.data.holidays.length === 1 ? "holiday" : "holidays"}` : ""}</p>
          <div className="list">
            {d.data.people.map((p) => (
              <div key={p.id} className="row" style={{ cursor: "default" }}>
                <span className="grow">
                  <span className="t">{p.name}</span>
                  <span className="s">{p.present + p.late} of {p.present + p.late + p.absent} came{p.late ? ` · ${p.late} late` : ""}</span>
                </span>
                <span className={`att-pct${p.pct !== null && p.pct < 60 ? " low" : ""}`}>{p.pct === null ? "–" : `${p.pct}%`}</span>
              </div>
            ))}
          </div>
        </>
      ))}
    </>
  );
}
