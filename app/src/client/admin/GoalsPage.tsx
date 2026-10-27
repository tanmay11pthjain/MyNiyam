"use client";
import { useState } from "react";
import { api } from "../api";
import { Button } from "../ui";
import { useAdmin } from "./AdminApp";
import { Icon } from "./icons";
import { Confirm, LoadError, Loading, Sheet, sayAdmin, shortDate, useLoad, useToast } from "./kit";
import type { Goal, GoalInput, GoalsPage as Page } from "@/lib/admin-types";

const STATE: Record<Goal["state"], { t: string; c: string }> = {
  live: { t: "Running", c: "ok" }, upcoming: { t: "Starts later", c: "warn" }, ended: { t: "Ended", c: "" },
};
const plus = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const span = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1;
const num = (n: number) => n.toLocaleString("en-IN");

/** Goals and challenges: shown on members' Sangh tab. A total for everyone, or a challenge each person finishes. */
export function GoalsPage() {
  const { sangh } = useAdmin();
  const toast = useToast();
  const d = useLoad<Page>(`/api/admin/goals?s=${sangh.id}`);
  const [editing, setEditing] = useState<{ g: Goal | null; draft: GoalInput } | null>(null);

  if (d.state === "loading") return <div className="page"><Loading rows={3} /></div>;
  if (d.state === "error") return <div className="page"><LoadError message={d.message} retry={d.retry} /></div>;
  const page = d.data;
  const blank = (kind: GoalInput["kind"]): GoalInput => ({
    kind, title: "", titleHi: null, niyamId: page.niyams[0]?.id ?? "", target: kind === "total" ? 10000 : null, days: kind === "challenge" ? 21 : null,
    startDate: page.today, endDate: plus(page.today, 20), allClasses: true, classIds: [],
  });

  return (
    <main className="page">
      <div className="page-title"><h1 data-hi="लक्ष्य">Goals and challenges</h1><p>Shown on members&apos; Sangh tab. Everyone works together; nobody loses.</p></div>
      {page.niyams.length === 0 ? (
        <div className="notice"><b>Add a niyam first</b><span>A goal counts one of your niyams.</span></div>
      ) : (
        <div className="btn-row">
          <Button onClick={() => setEditing({ g: null, draft: blank("total") })}><Icon.plus />Pathshala goal</Button>
          <Button kind="secondary" onClick={() => setEditing({ g: null, draft: blank("challenge") })}><Icon.plus />Challenge</Button>
        </div>
      )}
      <div className="notice">
        <b>Two kinds</b>
        <span><b>Pathshala goal:</b> everyone&apos;s count adds up, e.g. &ldquo;Paryushan: 10 lakh Navkar&rdquo;. <b>Challenge:</b> each person keeps a niyam on enough days, e.g. &ldquo;21 days of Navkarsi&rdquo;, and earns a badge.</span>
      </div>
      {page.goals.length > 0 && (
        <div className="list">
          {page.goals.map((g) => (
            <button key={g.id} type="button" className={`row${g.state === "ended" ? " dim" : ""}`} onClick={() => setEditing({ g, draft: { ...g } })}>
              <span className="grow">
                <span className="t">{g.title}</span>
                <span className="s">
                  <span className={`pill ${STATE[g.state].c}`} style={{ marginRight: 6 }}>{STATE[g.state].t}</span>
                  {g.niyamName} · {shortDate(g.startDate)} to {shortDate(g.endDate)} ·{" "}
                  {g.kind === "total" ? `${num(g.total)} of ${num(g.target ?? 0)}` : `${g.finishers} finished (${g.days} days)`}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
      {editing && <Editor key={editing.g?.id ?? editing.draft.kind} g={editing.g} initial={editing.draft} page={page}
        onClose={() => setEditing(null)} onSaved={(goals, msg) => { d.set({ ...page, goals }); setEditing(null); toast(msg); }} />}
    </main>
  );
}

function Editor({ g, initial, page, onClose, onSaved }: {
  g: Goal | null; initial: GoalInput; page: Page; onClose: () => void; onSaved: (goals: Goal[], msg: string) => void;
}) {
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [del, setDel] = useState(false);
  const up = (p: Partial<GoalInput>) => { setF((x) => ({ ...x, ...p })); setErr(null); };
  const total = f.kind === "total";
  const niyam = page.niyams.find((n) => n.id === f.niyamId);
  const unit = niyam?.type === "count" ? "counts (e.g. malas)" : niyam?.type === "duration" ? "minutes" : "times kept";

  function problem(): string | null {
    if (f.title.trim().length < 2) return "Write a title.";
    if (!f.niyamId) return "Pick a niyam.";
    if (f.startDate > f.endDate) return "The end date is before the start date.";
    if (span(f.startDate, f.endDate) > 367) return "A goal can run for at most a year.";
    if (total && !(f.target && f.target > 0)) return "Write the number to reach.";
    if (!total && !(f.days && f.days > 0)) return "Write how many days.";
    if (!total && f.days! > span(f.startDate, f.endDate)) return `The dates allow at most ${span(f.startDate, f.endDate)} days.`;
    if (!f.allClasses && !f.classIds.length) return "Pick at least one class.";
    return null;
  }

  async function save() {
    const p = problem();
    if (p) { setErr(p); return; }
    setBusy(true);
    const body = { ...f, title: f.title.trim(), target: total ? f.target : null, days: total ? null : f.days };
    const r = g
      ? await api<{ goals: Goal[] }>(`/api/admin/goals/${g.id}`, { method: "PUT", body })
      : await api<{ goals: Goal[] }>("/api/admin/goals", { body });
    setBusy(false);
    if (r.ok) onSaved(r.data.goals, g ? "Saved" : total ? "Goal started" : "Challenge started"); else setErr(sayAdmin(r.err));
  }

  if (del && g) {
    return (
      <Confirm title="Delete this goal?" action="Delete" onClose={() => setDel(false)}
        body={<p>&ldquo;{g.title}&rdquo; disappears from the Sangh tab. Members&apos; logs and any badges already earned stay.</p>}
        onConfirm={async () => {
          const r = await api<{ goals: Goal[] }>(`/api/admin/goals/${g.id}`, { method: "DELETE", body: {} });
          if (!r.ok) return sayAdmin(r.err);
          onSaved(r.data.goals, "Goal deleted");
          return null;
        }} />
    );
  }

  return (
    <Sheet title={g ? "Edit" : total ? "New pathshala goal" : "New challenge"} onClose={onClose}>
      <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className="field"><label className="label" htmlFor="gt">Title</label>
          <input id="gt" className="input" value={f.title} maxLength={80} placeholder={total ? "e.g. Paryushan: 10 lakh Navkar" : "e.g. 21 days of Navkarsi"} onChange={(e) => up({ title: e.target.value })} /></div>
        <div className="field"><label className="label" htmlFor="gth">Title in Hindi <span className="opt">(optional)</span></label>
          <input id="gth" lang="hi" className="input" value={f.titleHi ?? ""} maxLength={80} onChange={(e) => up({ titleHi: e.target.value || null })} /></div>
        <div className="field"><label className="label" htmlFor="gn">Which niyam counts</label>
          <select id="gn" className="input" value={f.niyamId} onChange={(e) => up({ niyamId: e.target.value })}>
            {page.niyams.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select></div>
        {total ? (
          <div className="field"><label className="label" htmlFor="gx">Reach together</label>
            <input id="gx" className="input" inputMode="numeric" value={f.target ?? ""} onChange={(e) => up({ target: Number(e.target.value.replace(/\D/g, "")) || null })} />
            <span className="hint">{unit}, added up for everyone</span></div>
        ) : (
          <div className="field"><label className="label" htmlFor="gd">Days each person keeps it</label>
            <input id="gd" className="input" inputMode="numeric" value={f.days ?? ""} onChange={(e) => up({ days: Number(e.target.value.replace(/\D/g, "")) || null })} />
            <span className="hint">Between the dates below. Those who finish get a badge.</span></div>
        )}
        <div className="grid-2">
          <div className="field"><label className="label" htmlFor="gs">From</label>
            <input id="gs" type="date" className="input" value={f.startDate} onChange={(e) => up({ startDate: e.target.value })} /></div>
          <div className="field"><label className="label" htmlFor="ge">Until</label>
            <input id="ge" type="date" className="input" value={f.endDate} min={f.startDate} onChange={(e) => up({ endDate: e.target.value })} /></div>
        </div>
        <div className="field">
          <span className="label">Who takes part</span>
          <div className="chips">
            <button type="button" className="chip" aria-pressed={f.allClasses} onClick={() => up({ allClasses: true })}>Everyone</button>
            <button type="button" className="chip" aria-pressed={!f.allClasses} onClick={() => up({ allClasses: false })}>Some classes</button>
          </div>
          {!f.allClasses && (
            <div className="chips">
              {page.classes.map((c) => {
                const on = f.classIds.includes(c.id);
                return <button key={c.id} type="button" className="chip" aria-pressed={on}
                  onClick={() => up({ classIds: on ? f.classIds.filter((x) => x !== c.id) : [...f.classIds, c.id] })}>{c.name}</button>;
              })}
            </div>
          )}
        </div>
        {err && <p className="msg err" role="alert">{err}</p>}
        <Button type="submit" busy={busy}>{g ? "Save" : "Start"}</Button>
        {g && <Button kind="quiet" onClick={() => setDel(true)}><span style={{ color: "var(--danger)" }}>Delete</span></Button>}
      </form>
    </Sheet>
  );
}
