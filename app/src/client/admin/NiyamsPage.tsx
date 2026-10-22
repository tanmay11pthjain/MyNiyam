"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "../api";
import { Button, Chevron } from "../ui";
import { useAdmin } from "./AdminApp";
import { Icon, NIYAM_ICON_NAMES, NIYAM_ICONS, NiyamIcon } from "./icons";
import { Confirm, LoadError, Loading, Sheet, Switch, UpDown, move, sayAdmin, useLoad, useToast } from "./kit";
import type { Niyam, NiyamInput, NiyamsPage, NiyamType } from "@/lib/admin-types";
import { NIYAM_LIBRARY, WEEKDAYS, niyamSummary } from "@/lib/niyam-library";

const TYPES: { type: NiyamType; t: string; s: string }[] = [
  { type: "yesno", t: "Done or not done", s: "One tap. e.g. Navkarsi, Jinpuja" },
  { type: "count", t: "A number", s: "e.g. 108 Navkar jaap" },
  { type: "duration", t: "Minutes", s: "e.g. 30 minutes of swadhyay" },
  { type: "choice", t: "Pick one option", s: "e.g. Ekasna, Ayambil or Upvas" },
];

const BLANK: NiyamInput = {
  name: "", nameHi: null, type: "yesno", target: null, options: [], icon: "lamp", note: null,
  allClasses: true, classIds: [], schedule: "daily", weekdays: [], startDate: null, endDate: null, isCore: true, timeHint: null, points: 10, dates: [],
};

type Editing = { niyam: Niyam | null; draft: NiyamInput };

export function NiyamsPage() {
  const { sangh } = useAdmin();
  const toast = useToast();
  const params = useSearchParams();
  const d = useLoad<NiyamsPage>(`/api/admin/niyams?s=${sangh.id}`);
  const [adding, setAdding] = useState(params.get("new") === "1");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [copying, setCopying] = useState(false);

  if (d.state === "loading") return <div className="page"><Loading rows={4} /></div>;
  if (d.state === "error") return <div className="page"><LoadError message={d.message} retry={d.retry} /></div>;
  const page = d.data;
  const classNames = new Map(page.classes.map((c) => [c.id, c.name]));
  const running = page.niyams.filter((n) => n.status !== "archived");
  const archived = page.niyams.filter((n) => n.status === "archived");
  const { reload } = d;
  const setNiyams = (niyams: Niyam[]) => d.set({ ...page, niyams });

  async function reorder(from: number, to: number) {
    const next = move(running, from, to);
    setNiyams([...next, ...archived]);
    const r = await api<{ niyams: Niyam[] }>("/api/admin/niyams", { method: "PUT", body: { ids: [...next, ...archived].map((n) => n.id) } });
    if (r.ok) setNiyams(r.data.niyams); else { toast(sayAdmin(r.err)); reload(); }
  }

  const row = (n: Niyam, i: number, list: Niyam[], movable: boolean) => (
    <div key={n.id} className={`row${n.status !== "active" ? " dim" : ""}`}>
      <button type="button" className="grow" style={{ display: "flex", gap: "var(--s-3)", alignItems: "center", border: 0, background: "none", textAlign: "left", padding: "var(--s-2) 0", cursor: "pointer", minWidth: 0 }}
        onClick={() => setEditing({ niyam: n, draft: { ...n } })}>
        <NiyamIcon name={n.icon} />
        <span style={{ minWidth: 0 }}>
          <span className="t">{n.name}{n.status === "paused" && <span className="pill warn" style={{ marginLeft: 8 }}>Paused</span>}</span>
          <span className="s">{niyamSummary(n, classNames)}</span>
        </span>
      </button>
      {movable && <UpDown index={i} count={list.length} label={n.name} onMove={(a, b) => void reorder(a, b)} />}
    </div>
  );

  return (
    <main className="page">
      <div className="page-title"><h1 data-hi="नियम">Niyams</h1><p>What members log each day, in this order.</p></div>

      {running.length === 0 ? (
        <div className="notice"><b>No niyams yet</b><span>Add the niyams your pathshala keeps. Start from the ready list; it takes one tap.</span></div>
      ) : (
        <div className="list">{running.map((n, i) => row(n, i, running, true))}</div>
      )}
      <Button onClick={() => setAdding(true)}><Icon.plus /> Add a niyam</Button>

      {archived.length > 0 && (
        <section className="section">
          <Button kind="quiet" aria-expanded={showArchived} onClick={() => setShowArchived(!showArchived)}>
            {showArchived ? "Hide" : "Show"} archived niyams ({archived.length})
          </Button>
          {showArchived && <div className="list">{archived.map((n, i) => row(n, i, archived, false))}</div>}
        </section>
      )}

      {page.classes.length > 1 && <Button kind="quiet" onClick={() => setCopying(true)}><Icon.copy /> Copy niyams from one class to another</Button>}
      {copying && <CopySheet classes={page.classes} onClose={() => setCopying(false)}
        onDone={(n, words) => { setNiyams(n); setCopying(false); toast(words); }} />}

      <LogWindow hours={page.logBackHours} onChange={(h) => d.set({ ...page, logBackHours: h })} />

      {adding && (
        <Sheet title="Add a niyam" onClose={() => setAdding(false)}>
          <button type="button" className="choice" onClick={() => { setAdding(false); setEditing({ niyam: null, draft: { ...BLANK } }); }}>
            <span className="niyam-icon"><Icon.plus /></span>
            <span className="grow"><span className="t">Make your own</span><span className="s">Start from a blank niyam</span></span>
            <Chevron />
          </button>
          <p className="label">Or pick a common one</p>
          <div className="list">
            {NIYAM_LIBRARY.map((n) => {
              const have = page.niyams.some((x) => x.name.toLowerCase() === n.name.toLowerCase() && x.status !== "archived");
              return (
                <button key={n.name} type="button" className="row" onClick={() => { setAdding(false); setEditing({ niyam: null, draft: { ...BLANK, ...n } }); }}>
                  <NiyamIcon name={n.icon} />
                  <span className="grow"><span className="t">{n.name} <span className="hi" lang="hi">{n.nameHi}</span></span>
                    <span className="s">{TYPES.find((t) => t.type === n.type)!.t}{n.target ? ` · ${n.target}${n.type === "duration" ? " min" : ""}` : ""}{have ? " · already added" : ""}</span></span>
                  <Chevron />
                </button>
              );
            })}
          </div>
        </Sheet>
      )}
      {editing && (
        <NiyamEditor editing={editing} classes={page.classes} onClose={() => setEditing(null)}
          onSaved={(niyams, words) => { setNiyams(niyams); setEditing(null); toast(words); }} />
      )}
    </main>
  );
}

function LogWindow({ hours, onChange }: { hours: number; onChange: (h: number) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <section className="section">
      <h2>Catching up</h2>
      <div className="list">
        <Switch label="Let members fill in yesterday" busy={busy}
          sub={hours ? "A missed evening can be logged until the end of the next day." : "Off: members can only log today."}
          checked={hours > 0}
          onChange={async (v) => {
            setBusy(true);
            const r = await api<{ logBackHours: number }>("/api/admin/sangh", { method: "PATCH", body: { logBackHours: v ? 24 : 0 } });
            setBusy(false);
            if (r.ok) { onChange(r.data.logBackHours); toast(v ? "Members can fill in yesterday" : "Members can log today only"); } else toast(sayAdmin(r.err));
          }} />
      </div>
    </section>
  );
}

function NiyamEditor({ editing, classes, onClose, onSaved }: {
  editing: Editing; classes: { id: string; name: string }[]; onClose: () => void; onSaved: (n: Niyam[], words: string) => void;
}) {
  const { niyam } = editing;
  const [f, setF] = useState<NiyamInput>(editing.draft);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const set = (patch: Partial<NiyamInput>) => { setF({ ...f, ...patch }); setErr(null); };
  const today = new Date().toISOString().slice(0, 10);

  function problem(): string | null {
    if (!f.name.trim()) return "Write the niyam's name.";
    if ((f.type === "count" || f.type === "duration") && !f.target) return f.type === "count" ? "Write the daily target, for example 108." : "Write how many minutes.";
    if (f.type === "choice" && (f.options.length < 2 || f.options.some((o) => !o.en.trim()))) return "Write at least two options.";
    if (!f.allClasses && f.classIds.length === 0) return "Pick at least one class.";
    if (f.schedule === "weekdays" && f.weekdays.length === 0) return "Pick at least one day.";
    if (f.schedule === "dates" && f.dates.length === 0) return "Add at least one date.";
    if (f.schedule === "range" && (!f.startDate || !f.endDate || f.startDate > f.endDate)) return "Pick a start date and an end date after it.";
    return null;
  }

  async function save() {
    const p = problem();
    if (p) { setErr(p); return; }
    setBusy(true);
    const r = await api<{ niyams: Niyam[] }>(niyam ? `/api/admin/niyams/${niyam.id}` : "/api/admin/niyams", { method: niyam ? "PUT" : "POST", body: f });
    setBusy(false);
    if (r.ok) onSaved(r.data.niyams, niyam ? "Niyam saved" : `Added ${f.name}`); else setErr(sayAdmin(r.err));
  }

  async function status(s: Niyam["status"], words: string): Promise<string | null> {
    const r = await api<{ niyams: Niyam[] }>(`/api/admin/niyams/${niyam!.id}`, { method: "PATCH", body: { status: s } });
    if (!r.ok) return sayAdmin(r.err);
    onSaved(r.data.niyams, words);
    return null;
  }

  if (confirmArchive && niyam) {
    return (
      <Confirm title={`Archive ${niyam.name}?`} action="Archive niyam" onClose={() => setConfirmArchive(false)}
        body={<><p>Members stop seeing it. Everything they logged so far is kept.</p><p>You can bring it back later from &ldquo;Show archived niyams&rdquo;.</p></>}
        onConfirm={() => status("archived", `Archived ${niyam.name}`)} />
    );
  }

  return (
    <Sheet title={niyam ? "Edit niyam" : "New niyam"} onClose={onClose}>
      <form className="stack-lg" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className="field"><label className="label" htmlFor="nn">Name</label><input id="nn" className="input" value={f.name} maxLength={60} placeholder="e.g. Navkarsi" onChange={(e) => set({ name: e.target.value })} /></div>
        <div className="field"><label className="label" htmlFor="nh">Name in Hindi <span className="opt">(optional)</span></label><input id="nh" lang="hi" className="input" value={f.nameHi ?? ""} maxLength={60} onChange={(e) => set({ nameHi: e.target.value || null })} /></div>

        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label">How do members log it?</legend>
          <div className="stack" role="radiogroup" aria-label="How do members log it?">
            {TYPES.map((t) => (
              <button key={t.type} type="button" role="radio" aria-checked={f.type === t.type} className="choice" style={{ minHeight: 64 }}
                onClick={() => set({ type: t.type, target: t.type === "count" ? f.target ?? 108 : t.type === "duration" ? f.target ?? 30 : null,
                  options: t.type === "choice" && f.options.length < 2 ? [{ value: "o1", en: "" }, { value: "o2", en: "" }] : f.options })}>
                <span className="radio-dot" aria-hidden="true" />
                <span className="grow"><span className="t">{t.t}</span><span className="s">{t.s}</span></span>
              </button>
            ))}
          </div>
        </fieldset>

        {(f.type === "count" || f.type === "duration") && (
          <div className="field">
            <label className="label" htmlFor="nt">{f.type === "count" ? "Daily target" : "Minutes each day"}</label>
            <input id="nt" className="input" inputMode="numeric" value={f.target ?? ""} maxLength={6} style={{ maxWidth: 200 }}
              onChange={(e) => set({ target: e.target.value ? Number(e.target.value.replace(/\D/g, "")) || null : null })} />
          </div>
        )}

        {f.type === "choice" && (
          <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label">Options</legend>
            {f.options.map((o, i) => (
              <div key={o.value} style={{ display: "flex", gap: "var(--s-2)" }}>
                <input aria-label={`Option ${i + 1}`} className="input input-sm" value={o.en} maxLength={40} placeholder={`Option ${i + 1}`}
                  onChange={(e) => set({ options: f.options.map((x, j) => (j === i ? { ...x, en: e.target.value } : x)) })} />
                <input aria-label={`Tej for option ${i + 1}`} className="input input-sm opt-tej" inputMode="numeric" maxLength={3} placeholder={`${f.points} Tej`}
                  value={o.points ?? ""} onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, "");
                    set({ options: f.options.map((x, j) => (j === i ? { ...x, points: v ? Math.min(500, Number(v)) : undefined } : x)) });
                  }} />
                <button type="button" className="icon-btn" aria-label={`Remove option ${i + 1}`} disabled={f.options.length <= 2}
                  onClick={() => set({ options: f.options.filter((_, j) => j !== i) })}><Icon.trash /></button>
              </div>
            ))}
            {f.options.length < 12 && <button type="button" className="chip" style={{ justifySelf: "start" }}
              onClick={() => set({ options: [...f.options, { value: `o${Date.now().toString(36)}`, en: "" }] })}>+ Add an option</button>}
            <p className="hint">Tapasya levels: put them from small to big and give bigger ones more Tej (for example Navkarsi 10, Ekasan 30, Upvas 100). Empty uses {f.points} Tej.</p>
          </fieldset>
        )}

        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label">Who keeps it?</legend>
          <div className="chips">
            <button type="button" className="chip" aria-pressed={f.allClasses} onClick={() => set({ allClasses: true })}>All classes</button>
            <button type="button" className="chip" aria-pressed={!f.allClasses} onClick={() => set({ allClasses: false })}>Some classes</button>
          </div>
          {!f.allClasses && (
            <div className="chips">
              {classes.map((c) => {
                const on = f.classIds.includes(c.id);
                return <button key={c.id} type="button" className="chip" aria-pressed={on}
                  onClick={() => set({ classIds: on ? f.classIds.filter((x) => x !== c.id) : [...f.classIds, c.id] })}>{c.name}</button>;
              })}
            </div>
          )}
        </fieldset>

        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label">Which days?</legend>
          <div className="chips">
            <button type="button" className="chip" aria-pressed={f.schedule === "daily"} onClick={() => set({ schedule: "daily" })}>Every day</button>
            <button type="button" className="chip" aria-pressed={f.schedule === "weekdays"} onClick={() => set({ schedule: "weekdays" })}>Some days of the week</button>
            <button type="button" className="chip" aria-pressed={f.schedule === "range"} onClick={() => set({ schedule: "range", startDate: f.startDate ?? today })}>Between two dates</button>
            <button type="button" className="chip" aria-pressed={f.schedule === "dates"} onClick={() => set({ schedule: "dates" })}>Tithi days (pick dates)</button>
          </div>
          {f.schedule === "weekdays" && (
            <div className="chips">
              {WEEKDAYS.map((w, i) => {
                const on = f.weekdays.includes(i);
                return <button key={w} type="button" className="chip" aria-pressed={on}
                  onClick={() => set({ weekdays: on ? f.weekdays.filter((x) => x !== i) : [...f.weekdays, i] })}>{w}</button>;
              })}
            </div>
          )}
          {f.schedule === "dates" && <TithiDates dates={f.dates} today={today} onChange={(dates) => set({ dates })} />}
          {f.schedule === "range" && (
            <div className="grid-2">
              <div className="field"><label className="label" htmlFor="ns">From</label><input id="ns" type="date" className="input" value={f.startDate ?? ""} onChange={(e) => set({ startDate: e.target.value || null })} /></div>
              <div className="field"><label className="label" htmlFor="ne">To</label><input id="ne" type="date" className="input" value={f.endDate ?? ""} min={f.startDate ?? undefined} onChange={(e) => set({ endDate: e.target.value || null })} /></div>
            </div>
          )}
        </fieldset>

        <div className="list">
          {f.type === "yesno" && (
            <div className="field">
              <span className="label">Show a time on the card</span>
              <div className="chips">
                <button type="button" className="chip" aria-pressed={f.timeHint === null} onClick={() => set({ timeHint: null })}>No time</button>
                <button type="button" className="chip" aria-pressed={f.timeHint === "navkarsi"} onClick={() => set({ timeHint: "navkarsi" })}>Navkarsi time</button>
                <button type="button" className="chip" aria-pressed={f.timeHint === "chauvihar"} onClick={() => set({ timeHint: "chauvihar" })}>Chauvihar time</button>
              </div>
              <p className="hint">{f.timeHint === "navkarsi" ? "Members see \"By 7:14 am\": 48 minutes after sunrise." : f.timeHint === "chauvihar" ? "Members see \"Before 6:02 pm\": sunset." : "Times come from your pathshala's place (Setup, Pathshala)."}</p>
            </div>
          )}
          <div className="field">
            <span className="label">Tej for keeping it</span>
            <div className="chips">
              {[0, 5, 10, 20, 50].map((v) => <button key={v} type="button" className="chip" aria-pressed={f.points === v} onClick={() => set({ points: v })}>{v === 0 ? "None" : `${v} Tej`}</button>)}
            </div>
            <p className="hint">{f.type === "count" || f.type === "duration" ? `${f.points} Tej for each ${f.type === "count" ? "count" : "minute"}, up to 10 a day.` : "Members earn Tej points each time they keep it."}</p>
          </div>
          <Switch label="Counts in daily progress" sub={f.isCore ? "A core niyam." : "Optional: members can log it, but it doesn't count."} checked={f.isCore} onChange={(v) => set({ isCore: v })} />
        </div>

        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label">Picture</legend>
          <div className="icons">
            {NIYAM_ICON_NAMES.map((name) => (
              <button key={name} type="button" aria-pressed={f.icon === name} aria-label={name} onClick={() => set({ icon: name })}>{NIYAM_ICONS[name]()}</button>
            ))}
          </div>
        </fieldset>

        <div className="field"><label className="label" htmlFor="nno">Short note <span className="opt">(optional, shown to members)</span></label>
          <textarea id="nno" className="input" value={f.note ?? ""} maxLength={200} placeholder="e.g. No food or water until 48 minutes after sunrise." onChange={(e) => set({ note: e.target.value || null })} /></div>

        {err && <p className="msg err" role="alert">{err}</p>}
        <Button type="submit" busy={busy}>{busy ? "Saving…" : niyam ? "Save niyam" : "Add niyam"}</Button>
      </form>

      {niyam && (
        <div className="stack">
          {niyam.status === "active" && <Button kind="secondary" onClick={() => void status("paused", `Paused ${niyam.name}`)}>Pause for now</Button>}
          {niyam.status !== "active" && <Button kind="secondary" onClick={() => void status("active", `${niyam.name} is running again`)}>Start it again</Button>}
          {niyam.status !== "archived" && (
            <Button kind="quiet" onClick={() => setConfirmArchive(true)}><span style={{ color: "var(--danger)" }}>Archive this niyam</span></Button>
          )}
          <p className="hint center">Pausing or archiving keeps everything already logged.</p>
        </div>
      )}
    </Sheet>
  );
}

/** Dates for a tithi niyam: Ashtami, Chaudas, Paryushan days. Picked one by one from the calendar. */
function TithiDates({ dates, today, onChange }: { dates: string[]; today: string; onChange: (d: string[]) => void }) {
  const [pick, setPick] = useState("");
  const label = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const add = () => { if (pick && !dates.includes(pick) && dates.length < 120) onChange([...dates, pick].sort()); setPick(""); };
  return (
    <div className="stack">
      <div style={{ display: "flex", gap: "var(--s-2)" }}>
        <input type="date" className="input" aria-label="Date to add" min={today} value={pick} onChange={(e) => setPick(e.target.value)} />
        <button type="button" className="chip" disabled={!pick} onClick={add}>Add date</button>
      </div>
      {dates.length === 0 ? <p className="hint">Add the tithi dates from your panchang, for example each Ashtami and Chaudas.</p> : (
        <div className="chips">
          {dates.map((d) => (
            <button key={d} type="button" className="chip" aria-label={`Remove ${label(d)}`} onClick={() => onChange(dates.filter((x) => x !== d))}>{label(d)} ✕</button>
          ))}
        </div>
      )}
    </div>
  );
}

function CopySheet({ classes, onClose, onDone }: { classes: { id: string; name: string }[]; onClose: () => void; onDone: (n: Niyam[], words: string) => void }) {
  const [from, setFrom] = useState(classes[0].id);
  const [to, setTo] = useState(classes[1].id);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const name = (id: string) => classes.find((c) => c.id === id)?.name ?? "";
  return (
    <Sheet title="Copy niyams" onClose={onClose}>
      <form className="stack" noValidate onSubmit={async (e) => {
        e.preventDefault();
        if (from === to) { setErr("Pick two different classes."); return; }
        setBusy(true);
        const r = await api<{ added: number; niyams: Niyam[] }>("/api/admin/niyams/copy", { body: { from, to } });
        setBusy(false);
        if (r.ok) onDone(r.data.niyams, r.data.added ? `${r.data.added} ${r.data.added === 1 ? "niyam" : "niyams"} added to ${name(to)}` : `${name(to)} already had them all`);
        else setErr(sayAdmin(r.err));
      }}>
        <p>Every niyam set for the first class is also set for the second. Niyams for all classes need nothing.</p>
        <div className="field"><label className="label" htmlFor="cf">From</label>
          <select id="cf" className="input" value={from} onChange={(e) => { setFrom(e.target.value); setErr(null); }}>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="field"><label className="label" htmlFor="ct">To</label>
          <select id="ct" className="input" value={to} onChange={(e) => { setTo(e.target.value); setErr(null); }}>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        {err && <p className="msg err" role="alert">{err}</p>}
        <Button type="submit" busy={busy}>{busy ? "Copying…" : "Copy niyams"}</Button>
      </form>
    </Sheet>
  );
}
