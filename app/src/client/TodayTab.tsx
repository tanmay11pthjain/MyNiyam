"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, say } from "./api";
import { applyPatch, NiyamCard, type LogPatch } from "./NiyamCard";
import { enqueue, flushQueue, onQueueChange, queued, readCopy, saveCopy } from "./offline";
import { Button } from "./ui";
import { InstallCard } from "./Install";
import { Vows } from "./Vows";
import { shareCard } from "./share";
import type { DayNiyam, DayView, TodayResponse } from "@/lib/today-types";

type Words = { en: string; hi: string };

export const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

const anyDone = (d: DayView) => d.niyams.some((n) => n.done);
const indianToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

/** Today as the server last said, with this phone's not-yet-sent taps laid on top. */
function withQueued(t: TodayResponse, profileId: string): TodayResponse {
  const mine = queued().filter((q) => q.profileId === profileId && q.date === t.today.date);
  if (!mine.length) return t;
  return { ...t, today: { ...t.today, niyams: t.today.niyams.map((n) => {
    const q = mine.find((x) => x.niyamId === n.id);
    return q ? applyPatch(n, q.patch) : n;
  }) } };
}

/** The server's Today, or offline the copy saved on this phone (only if it is still the same day). */
async function fetchToday(profileId: string): Promise<{ data: TodayResponse; offline: boolean } | { err: Words }> {
  const r = await api<TodayResponse>("/api/today");
  if (r.ok) { saveCopy(`today.${profileId}`, { ...r.data, newBadges: [] }); return { data: withQueued(r.data, profileId), offline: false }; }
  if (r.err.error === "offline") {
    const copy = readCopy<TodayResponse>(`today.${profileId}`);
    if (copy && copy.today.date === indianToday()) return { data: withQueued(copy, profileId), offline: true };
  }
  return { err: say(r.err) };
}

const yesterdayOf = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);

/** The home tab: today's niyams, a progress bar and the streak. Yesterday is changed from History. */
export function TodayTab({ profileId, sangh }: { profileId: string; sangh: { name: string; code: string } }) {
  const [data, setData] = useState<TodayResponse | null>(null);
  const [err, setErr] = useState<Words | null>(null);
  const [toast, setToast] = useState<Words | null>(null);
  const [offline, setOffline] = useState(false);
  const [waiting, setWaiting] = useState(() => queued().length);
  const dataRef = useRef<TodayResponse | null>(null);
  useEffect(() => { dataRef.current = data; }, [data]);
  const pending = useRef(new Map<string, { n: number; chain: Promise<unknown> }>());
  const [repairing, setRepairing] = useState(false);

  const load = useCallback(async () => {
    const r = await fetchToday(profileId);
    if ("err" in r) setErr(r.err); else { setData(r.data); setOffline(r.offline); setErr(null); }
  }, [profileId]);

  // Sends what was saved offline, then shows the server's numbers (the streak moves only on the server).
  const sync = useCallback(async () => {
    if (!queued().length) return;
    const r = await flushQueue();
    if (r.offline) return;
    setOffline(false);
    if (r.refused) setToast({ en: "Some niyams logged offline couldn't be saved: that day had closed.", hi: "ऑफ़लाइन लिखे कुछ नियम सेव नहीं हुए: वह दिन बंद हो चुका था।" });
    void load();
  }, [load]);

  useEffect(() => {
    let live = true;
    void fetchToday(profileId).then((r) => {
      if (!live) return;
      if ("err" in r) setErr(r.err); else { setData(r.data); setOffline(r.offline); }
    });
    const first = window.setTimeout(() => void sync(), 0);
    const off = onQueueChange(() => setWaiting(queued().length));
    const back = () => { void sync(); };
    window.addEventListener("online", back);
    return () => { live = false; window.clearTimeout(first); off(); window.removeEventListener("online", back); };
  }, [profileId, sync]);

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
      // Taps waiting from an offline spell go first, so they land in the order they were made.
      if (queued().length) {
        enqueue({ profileId, niyamId: n.id, date: day.date, patch });
        slot.n -= 1;
        void sync();
        return;
      }
      const r = await api<{ niyam: DayNiyam }>("/api/log", { body: { profileId, niyamId: n.id, date: day.date, ...patch } });
      slot.n -= 1;
      if (!r.ok && r.err.error === "offline") {
        // Keep it on screen and on this phone; it is sent when the connection is back.
        enqueue({ profileId, niyamId: n.id, date: day.date, patch });
        setOffline(true);
        return;
      }
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
            <svg viewBox="0 0 24 24" aria-hidden="true" className={`${data.streak > 0 ? "lit" : ""} diya-${data.progress?.diya ?? 0}`}>
              <path className="flame" d="M12 3c2.2 2.6 3 4.4 3 6.2A3 3 0 0 1 12 12a3 3 0 0 1-3-2.8C9 7.4 9.8 5.6 12 3z" />
              <path className="base" d="M3 14h18c-.6 3.6-4.4 6-9 6s-8.4-2.4-9-6z" />
            </svg>
            <b>{data.streak}</b><span>{data.streak === 1 ? "day" : "days"}</span>
          </div>
        </div>
        <div className="pbar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Today's progress"><i style={{ width: `${pct}%` }} /></div>
        <p className="hint pr-line" role="status">
          {allDone ? "All done. Anumodana!" : data.streak > 0 ? "Keep the lamp lit." : "Log one niyam to start your streak."}
          {data.progress && data.progress.tejToday > 0 && <> · +{data.progress.tejToday} Tej today</>}
        </p>
        {data.progress?.kshamaUsedOn.includes(yesterdayOf(day.date)) && (
          <p className="kshama-note">A kshama day kept your streak safe yesterday.</p>
        )}
        {data.streak >= 3 && (
          <button type="button" className="link-btn" onClick={() => void shareCard({ big: String(data.streak), line: `${data.streak}-day niyam streak`, sub: "Jai Jinendra", sangh: sangh.name, code: sangh.code })}>
            Share my streak
          </button>
        )}
      </section>

      {data.newBadges?.map((b) => (
        <section key={b.id} className="card badge-new" role="status">
          <span className="badge-mark" aria-hidden="true">{b.mark}</span>
          <div className="grow">
            <p className="label">New badge · नया बैज</p>
            <p className="badge-name">{b.en} <span className="hi" lang="hi">{b.hi}</span></p>
          </div>
          <Button kind="secondary" onClick={() => void shareCard({ big: b.mark, line: b.en, sub: "Anumodana!", sangh: sangh.name, code: sangh.code })}>Share</Button>
        </section>
      ))}

      {data.progress?.repair && (
        <section className="card repair" aria-labelledby="repair-h">
          <h2 id="repair-h" className="sec-h">Save your {data.progress.repair.streak}-day streak</h2>
          <p>You missed {dayLabel(data.progress.repair.missed)}. Michchhami Dukkadam, start fresh: keep one small extra niyam today, like 1 extra Navkar mala, then tap below.</p>
          <p className="hint" lang="hi">एक छोटा अतिरिक्त नियम करें, जैसे 1 नवकार माला, फिर नीचे दबाएँ।</p>
          <Button busy={repairing} onClick={async () => {
            setRepairing(true);
            const r = await api("/api/repair", { body: { missed: data.progress.repair!.missed } });
            setRepairing(false);
            if (r.ok) { setToast({ en: "Your streak is safe again. Anumodana!", hi: "आपकी लगातार गिनती फिर सुरक्षित है।" }); void load(); } else setToast(say(r.err));
          }}>I did it, keep my streak</Button>
          <p className="hint">You can do this once a month.</p>
        </section>
      )}

      {(offline || waiting > 0) && (
        <div className="banner warn" role="status">
          <b>{offline ? "You're offline" : "Sending…"}</b>
          <span>{waiting > 0 ? `${waiting} ${waiting === 1 ? "niyam is" : "niyams are"} saved on this phone and will be sent when you're back online.` : "Your taps are saved on this phone and sent when you're back online."}</span>
        </div>
      )}

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

      {data.vows && <Vows vows={data.vows} today={day.date} onChanged={() => void load()} />}

      <InstallCard />

      {toast && (
        <div className="toast" role="alert">
          {toast.en}{" "}
          <button type="button" className="toast-x" onClick={() => setToast(null)}>OK</button>
        </div>
      )}
    </div>
  );
}
