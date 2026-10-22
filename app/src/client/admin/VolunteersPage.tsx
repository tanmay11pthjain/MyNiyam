"use client";
import { useState } from "react";
import { api } from "../api";
import { Button, Chevron } from "../ui";
import { useAdmin } from "./AdminApp";
import { Icon } from "./icons";
import { Confirm, LoadError, Loading, Sheet, Switch, sayAdmin, useLoad, useToast } from "./kit";
import type { Perm, Volunteer, VolunteersPage as Page } from "@/lib/admin-types";

const PERM_WORDS: { perm: Perm; t: string; s: string }[] = [
  { perm: "view_members", t: "See members and their logs", s: "Only in their classes." },
  { perm: "attendance", t: "Take attendance", s: "For their classes' sessions." },
  { perm: "announcements", t: "Post announcements", s: "To the whole pathshala or chosen classes." },
  { perm: "niyams", t: "Add and change niyams", s: "For the whole pathshala." },
  { perm: "setup", t: "Edit classes and the join form", s: "And move members between classes." },
  { perm: "remove_members", t: "Remove members", s: "Only in their classes." },
];

type Draft = { phone: string; name: string; classIds: string[]; perms: Perm[] };
const NEW: Draft = { phone: "", name: "", classIds: [], perms: ["view_members", "attendance"] };

const timeAgo = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

/** Volunteers and teachers: hand parts of the work to others without full control. Admins only. */
export function VolunteersPage() {
  const { sangh, can } = useAdmin();
  const toast = useToast();
  const d = useLoad<Page>(can("admin") ? `/api/admin/volunteers?s=${sangh.id}` : null);
  const [editing, setEditing] = useState<{ v: Volunteer | null; draft: Draft } | null>(null);

  if (!can("admin")) return <main className="page"><div className="banner err">Only the pathshala&apos;s admins can manage volunteers.</div></main>;
  if (d.state === "loading") return <div className="page"><Loading rows={3} /></div>;
  if (d.state === "error") return <div className="page"><LoadError message={d.message} retry={d.retry} /></div>;
  const page = d.data;
  const classNames = new Map(page.classes.map((c) => [c.id, c.name]));

  return (
    <main className="page">
      <div className="page-title"><h1 data-hi="स्वयंसेवक और शिक्षक">Volunteers and teachers</h1><p>They sign in at the admin page with their own number and see only what you allow.</p></div>
      <Button onClick={() => setEditing({ v: null, draft: { ...NEW } })}><Icon.plus />Add a volunteer</Button>

      {page.volunteers.length === 0 ? (
        <div className="notice"><b>No volunteers yet</b><span>Add a teacher for one class, for example a Bal Varg teacher who takes attendance.</span></div>
      ) : (
        <div className="list">
          {page.volunteers.map((v) => (
            <button key={v.phone} type="button" className="row" onClick={() => setEditing({ v, draft: { phone: v.phone, name: v.name, classIds: v.classIds, perms: v.perms } })}>
              <span className="niyam-icon"><Icon.people /></span>
              <span className="grow">
                <span className="t">{v.name}</span>
                <span className="s">{v.phone} · {v.classIds.length ? v.classIds.map((c) => classNames.get(c)).filter(Boolean).join(", ") : "All classes"} · {v.perms.length} {v.perms.length === 1 ? "permission" : "permissions"}</span>
              </span>
              <Chevron />
            </button>
          ))}
        </div>
      )}

      <section className="section" aria-labelledby="act-h">
        <h2 id="act-h">Activity log</h2>
        {page.activity.length === 0 ? <p className="hint">Changes to members, niyams and announcements show up here.</p> : (
          <ul className="list" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {page.activity.map((a, i) => (
              <li key={i} className="row" style={{ cursor: "default" }}>
                <span className="grow">
                  <span className="t">{a.action}{a.detail ? `: ${a.detail}` : ""}</span>
                  <span className="s">{a.who} · {timeAgo(a.at)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing && <Editor v={editing.v} initial={editing.draft} page={page} onClose={() => setEditing(null)}
        onSaved={(p, msg) => { d.set(p); setEditing(null); toast(msg); }} />}
    </main>
  );
}

function Editor({ v, initial, page, onClose, onSaved }: { v: Volunteer | null; initial: Draft; page: Page; onClose: () => void; onSaved: (p: Page, msg: string) => void }) {
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState(false);
  const [q, setQ] = useState("");
  const [del, setDel] = useState(false);
  const up = (p: Partial<Draft>) => { setF((x) => ({ ...x, ...p })); setErr(null); };

  async function save() {
    if (!f.name.trim()) { setErr("Write the volunteer's name."); return; }
    if (f.phone.replace(/\D/g, "").length < 10) { setErr("Enter a 10-digit mobile number."); return; }
    setBusy(true);
    const r = await api<Page>("/api/admin/volunteers", { body: { ...f, name: f.name.trim() } });
    setBusy(false);
    if (r.ok) onSaved(r.data, v ? "Volunteer saved" : `${f.name.trim()} added. They can sign in at the admin page now.`); else setErr(sayAdmin(r.err));
  }

  if (del && v) {
    return (
      <Confirm title={`Remove ${v.name}?`} action="Remove volunteer" onClose={() => setDel(false)}
        body={<p>{v.name} can no longer open this pathshala in the admin panel. Nothing else changes.</p>}
        onConfirm={async () => {
          const r = await api<Page>("/api/admin/volunteers", { method: "DELETE", body: { phone: v.phone } });
          if (!r.ok) return sayAdmin(r.err);
          onSaved(r.data, "Volunteer removed");
          return null;
        }} />
    );
  }

  if (pick) {
    const ql = q.trim().toLowerCase();
    const list = page.members.filter((m) => !ql || m.name.toLowerCase().includes(ql) || m.phone.replace(/\D/g, "").includes(ql.replace(/\D/g, "") || "~"));
    return (
      <Sheet title="Pick a member" onClose={() => setPick(false)}>
        <input className="input" placeholder="Search by name or number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search members" />
        <div className="list" style={{ maxHeight: "50vh", overflowY: "auto" }}>
          {list.slice(0, 100).map((m) => (
            <button key={m.phone} type="button" className="row" onClick={() => { up({ name: m.name, phone: m.phone }); setPick(false); }}>
              <span className="grow"><span className="t">{m.name}</span><span className="s">{m.phone}</span></span>
            </button>
          ))}
          {list.length === 0 && <p className="hint">No member found. Go back and type the number instead.</p>}
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title={v ? `Edit ${v.name}` : "Add a volunteer"} onClose={onClose}>
      <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {!v && <Button kind="secondary" onClick={() => setPick(true)}>Pick from members</Button>}
        <div className="field"><label className="label" htmlFor="vn">Name</label>
          <input id="vn" className="input" value={f.name} maxLength={60} onChange={(e) => up({ name: e.target.value })} /></div>
        <div className="field"><label className="label" htmlFor="vp">Mobile number</label>
          <div className="phone-row"><span className="cc" aria-hidden="true">+91</span>
            <input id="vp" type="tel" inputMode="numeric" maxLength={14} value={f.phone.replace(/^\+91\s?/, "")} disabled={!!v} onChange={(e) => up({ phone: e.target.value })} /></div></div>

        <div className="field">
          <span className="label">Classes</span>
          <div className="chips">
            <button type="button" className="chip" aria-pressed={f.classIds.length === 0} onClick={() => up({ classIds: [] })}>All classes</button>
            {page.classes.map((c) => {
              const on = f.classIds.includes(c.id);
              return <button key={c.id} type="button" className="chip" aria-pressed={on}
                onClick={() => up({ classIds: on ? f.classIds.filter((x) => x !== c.id) : [...f.classIds, c.id] })}>{c.name}</button>;
            })}
          </div>
        </div>

        <div className="field">
          <span className="label">What they can do</span>
          <div className="list">
            {PERM_WORDS.map((p) => (
              <Switch key={p.perm} label={p.t} sub={p.s} checked={f.perms.includes(p.perm)}
                onChange={(on) => up({ perms: on ? [...f.perms, p.perm] : f.perms.filter((x) => x !== p.perm) })} />
            ))}
          </div>
          <p className="hint">Pathshala details, the join code, volunteers and data requests stay with admins.</p>
        </div>

        {err && <p className="msg err" role="alert">{err}</p>}
        <Button type="submit" busy={busy}>{v ? "Save" : "Add volunteer"}</Button>
        {v && <Button kind="quiet" onClick={() => setDel(true)}><span style={{ color: "var(--danger)" }}>Remove volunteer</span></Button>}
      </form>
    </Sheet>
  );
}
