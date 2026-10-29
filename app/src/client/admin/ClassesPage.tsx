"use client";
import { useState } from "react";
import Link from "next/link";
import { api } from "../api";
import { Button } from "../ui";
import { useAdmin } from "./AdminApp";
import { Icon } from "./icons";
import { Confirm, LoadError, Loading, Sheet, Switch, UpDown, move, sayAdmin, useLoad, useToast } from "./kit";
import type { AdminClass } from "@/lib/admin-types";

type Classes = { classes: AdminClass[] };

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const daysText = (d: number[]) => (d.length === 7 ? "Every day" : d.length ? d.map((x) => WEEKDAYS[x]).join(", ") : null);

const ageText = (c: { ageMin: number | null; ageMax: number | null }) =>
  c.ageMin !== null && c.ageMax !== null ? `Age ${c.ageMin} to ${c.ageMax}` : c.ageMin !== null ? `Age ${c.ageMin}+` : c.ageMax !== null ? `Up to age ${c.ageMax}` : null;

export function ClassesPage() {
  const { sangh } = useAdmin();
  const toast = useToast();
  const d = useLoad<Classes>(`/api/admin/classes?s=${sangh.id}`);
  const [editing, setEditing] = useState<AdminClass | "new" | null>(null);

  if (d.state === "loading") return <div className="page"><Loading rows={4} /></div>;
  if (d.state === "error") return <div className="page"><LoadError message={d.message} retry={d.retry} /></div>;
  const classes = d.data.classes;

  async function reorder(from: number, to: number) {
    if (d.state !== "ready") return;
    const next = move(classes, from, to);
    d.set({ classes: next }); // show it at once; the server's answer replaces it
    const r = await api<Classes>("/api/admin/classes", { method: "PUT", body: { ids: next.map((c) => c.id) } });
    if (r.ok) d.set(r.data); else { toast(sayAdmin(r.err)); d.reload(); }
  }

  return (
    <main className="page">
      <div className="page-title"><h1 data-hi="कक्षाएँ">Classes</h1><p>New members pick one when they join, in this order.</p></div>
      {classes.length === 0 ? (
        <div className="notice"><b>No classes yet</b><span>Add the classes of your pathshala, for example Bal Varg or Mahila Mandal.</span></div>
      ) : (
        <div className="list">
          {classes.map((c, i) => (
            <div key={c.id} className={`row${c.hidden ? " dim" : ""}`}>
              <button type="button" className="grow" style={{ border: 0, background: "none", textAlign: "left", padding: "var(--s-2) 0", cursor: "pointer" }} onClick={() => setEditing(c)}>
                <span className="t">{c.name}</span>
                <span className="s">
                  {[c.nameHi, ageText(c), daysText(c.meetsOn)].filter(Boolean).join(" · ")}
                  {(c.nameHi || ageText(c) || c.meetsOn.length > 0) && <br />}
                  {c.members} {c.members === 1 ? "member" : "members"}{c.hidden ? " · hidden from new joins" : ""}
                </span>
              </button>
              <UpDown index={i} count={classes.length} label={c.name} onMove={(a, b) => void reorder(a, b)} />
            </div>
          ))}
        </div>
      )}
      <Button onClick={() => setEditing("new")}><Icon.plus /> Add a class</Button>
      {editing && (
        <ClassSheet cls={editing === "new" ? null : editing} all={classes} onClose={() => setEditing(null)}
          onSaved={(x, words) => { d.set({ classes: x }); setEditing(null); toast(words); }} />
      )}
    </main>
  );
}

function ClassSheet({ cls, all, onClose, onSaved }: { cls: AdminClass | null; all: AdminClass[]; onClose: () => void; onSaved: (c: AdminClass[], words: string) => void }) {
  const [moveTo, setMoveTo] = useState<string | null>(null);
  const [f, setF] = useState({
    name: cls?.name ?? "", nameHi: cls?.nameHi ?? "",
    ageMin: cls?.ageMin?.toString() ?? "", ageMax: cls?.ageMax?.toString() ?? "", hidden: cls?.hidden ?? false, meetsOn: cls?.meetsOn ?? [], leaderboard: cls?.leaderboard ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const age = (s: string) => (s.trim() === "" ? null : Number(s));

  async function save() {
    const ageMin = age(f.ageMin), ageMax = age(f.ageMax);
    if (!f.name.trim()) { setErr("Write the class name."); return; }
    if ([ageMin, ageMax].some((a) => a !== null && (!Number.isInteger(a) || a < 0 || a > 120))) { setErr("Ages are whole numbers from 0 to 120."); return; }
    if (ageMin !== null && ageMax !== null && ageMin > ageMax) { setErr("The first age should be the smaller one."); return; }
    setBusy(true); setErr(null);
    const body = { name: f.name.trim(), nameHi: f.nameHi.trim() || null, ageMin, ageMax, meetsOn: f.meetsOn, ...(cls ? { hidden: f.hidden, leaderboard: f.leaderboard } : {}) };
    const r = await api<Classes>(cls ? `/api/admin/classes/${cls.id}` : "/api/admin/classes", { method: cls ? "PATCH" : "POST", body });
    setBusy(false);
    if (r.ok) onSaved(r.data.classes, cls ? "Class saved" : `Added ${body.name}`);
    else setErr(r.err.error === "duplicate_key" ? "There is already a class with this name." : sayAdmin(r.err));
  }

  if (moveTo && cls) {
    const to = all.find((c) => c.id === moveTo)!;
    return (
      <Confirm title={`Move everyone in ${cls.name}?`} action={`Move to ${to.name}`} onClose={() => setMoveTo(null)}
        body={<p>All {cls.members} {cls.members === 1 ? "member" : "members"} of {cls.name} move to {to.name}, for example when the new year starts. Their logs stay.</p>}
        onConfirm={async () => {
          const r = await api<{ moved: number; classes: AdminClass[] }>(`/api/admin/classes/${cls.id}/move`, { body: { to: to.id } });
          if (!r.ok) return sayAdmin(r.err);
          onSaved(r.data.classes, `${r.data.moved} moved to ${to.name}`);
          return null;
        }} />
    );
  }

  if (confirmDelete && cls) {
    return (
      <Confirm title={`Delete ${cls.name}?`} action="Delete class" onClose={() => setConfirmDelete(false)}
        body={<p>The class goes for good. Niyams set for only this class will no longer be set for it.</p>}
        onConfirm={async () => {
          const r = await api<Classes>(`/api/admin/classes/${cls.id}`, { method: "DELETE", body: {} });
          if (!r.ok) return sayAdmin(r.err);
          onSaved(r.data.classes, `Deleted ${cls.name}`);
          return null;
        }} />
    );
  }

  return (
    <Sheet title={cls ? "Edit class" : "Add a class"} onClose={onClose}>
      <form className="stack-lg" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className="field"><label className="label" htmlFor="cn">Class name</label><input id="cn" className="input" value={f.name} maxLength={80} placeholder="e.g. Bal Varg" onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="field"><label className="label" htmlFor="cnh">Name in Hindi <span className="opt">(optional)</span></label><input id="cnh" lang="hi" className="input" value={f.nameHi} maxLength={80} placeholder="e.g. बाल वर्ग" onChange={(e) => setF({ ...f, nameHi: e.target.value })} /></div>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label">Age range <span className="opt">(optional, shown as a hint when joining)</span></legend>
          <div className="grid-2">
            <input aria-label="From age" className="input" inputMode="numeric" value={f.ageMin} placeholder="From" maxLength={3} onChange={(e) => setF({ ...f, ageMin: e.target.value.replace(/\D/g, "") })} />
            <input aria-label="To age" className="input" inputMode="numeric" value={f.ageMax} placeholder="To" maxLength={3} onChange={(e) => setF({ ...f, ageMax: e.target.value.replace(/\D/g, "") })} />
          </div>
        </fieldset>
        <div className="field">
          <span className="label">Class days <span className="opt">(optional, for attendance)</span></span>
          <div className="chips">
            {WEEKDAYS.map((w, i) => {
              const on = f.meetsOn.includes(i);
              return <button key={w} type="button" className="chip" aria-pressed={on}
                onClick={() => setF({ ...f, meetsOn: on ? f.meetsOn.filter((x) => x !== i) : [...f.meetsOn, i].sort() })}>{w}</button>;
            })}
          </div>
        </div>
        {cls && (
          <div className="list">
            <Switch label="Hide from new joins" sub="Members already in it keep it." checked={f.hidden} onChange={(v) => setF({ ...f, hidden: v })} />
            <Switch label="Weekly class board" sub="Members of this class see who earned the most Tej this week (top 10). On by default."
              checked={f.leaderboard} onChange={(v) => setF({ ...f, leaderboard: v })} />
          </div>
        )}
        {err && <p className="msg err" role="alert">{err}</p>}
        <Button type="submit" busy={busy}>{busy ? "Saving…" : cls ? "Save class" : "Add class"}</Button>
      </form>
      {cls && cls.members > 0 && all.length > 1 && (
        <div className="field">
          <label className="label" htmlFor="mv">Move everyone to another class</label>
          <select id="mv" className="input" value="" onChange={(e) => e.target.value && setMoveTo(e.target.value)}>
            <option value="">Pick a class…</option>
            {all.filter((c) => c.id !== cls.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}
      {cls && (cls.members > 0 ? (
        <div className="notice">
          <b>{cls.members} {cls.members === 1 ? "member is" : "members are"} in this class</b>
          <span>To delete it, first <Link href={`/admin/members?class=${cls.id}`}>move them to another class</Link>. Or hide it from new joins above.</span>
        </div>
      ) : (
        <Button kind="quiet" onClick={() => setConfirmDelete(true)}><span style={{ color: "var(--danger)", display: "inline-flex", gap: 8, alignItems: "center" }}><Icon.trash /> Delete this class</span></Button>
      ))}
    </Sheet>
  );
}
