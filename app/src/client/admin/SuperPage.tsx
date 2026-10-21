"use client";
import { useState } from "react";
import { api } from "../api";
import { Button, Chevron, SanghLogo } from "../ui";
import { useAdmin } from "./AdminApp";
import { Icon } from "./icons";
import { Confirm, LoadError, Loading, Sheet, sayAdmin, shortDate, useLoad, useToast } from "./kit";
import type { SuperSangh } from "@/lib/admin-types";
import { normalizeIndianPhone } from "@/lib/phone";

type List = { sanghs: SuperSangh[] };

/** For the MyNiyam super admin only: approve new pathshalas and choose who runs them. */
export function SuperPage() {
  const { refresh } = useAdmin();
  const toast = useToast();
  const d = useLoad<List>("/api/admin/super/sanghs");
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<SuperSangh | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (d.state === "loading") return <div className="page"><Loading rows={4} /></div>;
  if (d.state === "error") return <div className="page"><LoadError message={d.message} retry={d.retry} /></div>;
  const { reload } = d;
  const pending = d.data.sanghs.filter((s) => s.status === "pending");
  const active = d.data.sanghs.filter((s) => s.status === "active");
  const openSangh = d.data.sanghs.find((s) => s.id === open) ?? null;

  async function act(id: string, body: object, words: string): Promise<string | null> {
    const r = await api(`/api/admin/super/sanghs/${id}`, { method: "PATCH", body });
    if (!r.ok) return sayAdmin(r.err);
    toast(words); reload(); refresh();
    return null;
  }

  return (
    <main className="page">
      <div className="page-title"><h1>Super admin</h1><p>Approve new pathshalas and choose who runs each one.</p></div>

      <section className="section">
        <h2>Waiting for approval <small>{pending.length}</small></h2>
        {pending.length === 0 ? (
          <div className="notice"><b>Nothing waiting</b><span>New requests show up here.</span></div>
        ) : pending.map((s) => (
          <div key={s.id} className="card stack pending-card">
            <div style={{ display: "flex", gap: "var(--s-3)", alignItems: "center" }}>
              <SanghLogo name={s.name} url={null} />
              <div style={{ minWidth: 0 }}>
                <p style={{ font: "700 var(--fs-18) var(--font-display)" }}>{s.name}</p>
                <p className="hint">{s.city} · asked by {s.requestedBy ?? "unknown"} on {shortDate(s.createdAt)}</p>
              </div>
            </div>
            <div className="btn-row">
              <Button busy={busy === s.id} onClick={async () => { setBusy(s.id); const e = await act(s.id, { action: "approve" }, `${s.name} approved`); setBusy(null); if (e) toast(e); }}>Approve</Button>
              <Button kind="secondary" onClick={() => setRejecting(s)}>Turn down</Button>
            </div>
          </div>
        ))}
      </section>

      <section className="section">
        <h2>All pathshalas <small>{active.length}</small></h2>
        <div className="list">
          {active.map((s) => (
            <button key={s.id} type="button" className="row" onClick={() => setOpen(s.id)}>
              <SanghLogo name={s.name} url={null} />
              <span className="grow">
                <span className="t">{s.name}</span>
                <span className="s">{s.city} · {s.families} {s.families === 1 ? "family" : "families"} · {s.admins.length ? `${s.admins.length} admin${s.admins.length > 1 ? "s" : ""}` : "no admin yet"}</span>
              </span>
              <Chevron />
            </button>
          ))}
        </div>
        <Button kind="secondary" onClick={() => setAdding(true)}><Icon.plus /> Add a pathshala</Button>
      </section>

      {adding && <AddSangh onClose={() => setAdding(false)} onDone={(name) => { setAdding(false); toast(`${name} added`); reload(); refresh(); }} />}
      {openSangh && <Admins sangh={openSangh} onClose={() => setOpen(null)} act={act} />}
      {rejecting && (
        <Confirm title={`Turn down ${rejecting.name}?`} action="Turn down request" onClose={() => setRejecting(null)}
          body={<p>The request is deleted. The person who asked can send a new one.</p>}
          onConfirm={() => act(rejecting.id, { action: "reject" }, "Request turned down")} />
      )}
    </main>
  );
}

function AddSangh({ onClose, onDone }: { onClose: () => void; onDone: (name: string) => void }) {
  const [f, setF] = useState({ name: "", city: "", admin: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Sheet title="Add a pathshala" onClose={onClose}>
      <form className="stack-lg" noValidate onSubmit={async (e) => {
        e.preventDefault();
        if (f.name.trim().length < 2 || f.city.trim().length < 2) { setErr("Write the name and city."); return; }
        if (f.admin.trim() && !normalizeIndianPhone(f.admin)) { setErr("Enter the admin's 10-digit mobile number, or leave it empty."); return; }
        setBusy(true); setErr(null);
        const r = await api("/api/admin/super/sanghs", { body: { name: f.name.trim(), city: f.city.trim(), adminPhone: f.admin.trim() || undefined } });
        setBusy(false);
        if (r.ok) onDone(f.name.trim()); else setErr(sayAdmin(r.err));
      }}>
        <div className="field"><label className="label" htmlFor="an">Pathshala name</label><input id="an" className="input" value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="field"><label className="label" htmlFor="ac">City</label><input id="ac" className="input" value={f.city} maxLength={80} onChange={(e) => setF({ ...f, city: e.target.value })} /></div>
        <div className="field">
          <label className="label" htmlFor="ap">Admin&apos;s mobile number <span className="opt">(optional)</span></label>
          <div className="phone-row"><span className="cc" aria-hidden="true">+91</span><input id="ap" type="tel" inputMode="numeric" maxLength={14} value={f.admin} onChange={(e) => setF({ ...f, admin: e.target.value })} /></div>
          <p className="hint">They log in at /admin with this number.</p>
        </div>
        {err && <p className="msg err" role="alert">{err}</p>}
        <Button type="submit" busy={busy}>{busy ? "Adding…" : "Add pathshala"}</Button>
      </form>
    </Sheet>
  );
}

function Admins({ sangh, onClose, act }: { sangh: SuperSangh; onClose: () => void; act: (id: string, body: object, words: string) => Promise<string | null> }) {
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  if (removing) {
    return (
      <Confirm title="Remove this admin?" action="Remove admin" onClose={() => setRemoving(null)}
        body={<p><b>{removing}</b> can no longer run {sangh.name}. Their own membership, if any, is not affected.</p>}
        onConfirm={() => act(sangh.id, { action: "removeAdmin", phone: removing }, "Admin removed")} />
    );
  }
  return (
    <Sheet title={sangh.name} onClose={onClose}>
      <p className="hint">{sangh.city} · code {sangh.joinCode} · {sangh.families} {sangh.families === 1 ? "family" : "families"}</p>
      <h3 className="label">Admins</h3>
      {sangh.admins.length === 0 ? <div className="notice"><b>No admin yet</b><span>Add someone below so the pathshala can be set up.</span></div> : (
        <div className="list">
          {sangh.admins.map((a) => (
            <div key={a} className="row">
              <span className="grow"><span className="t" style={{ fontFamily: "var(--font-mono)" }}>{a}</span></span>
              <button type="button" className="icon-btn" aria-label={`Remove admin ${a}`} onClick={() => setRemoving(a)}><Icon.trash /></button>
            </div>
          ))}
        </div>
      )}
      <form className="stack" noValidate onSubmit={async (e) => {
        e.preventDefault();
        const p = normalizeIndianPhone(phone);
        if (!p) { setErr("Enter a 10-digit mobile number."); return; }
        setBusy(true); setErr(null);
        const problem = await act(sangh.id, { action: "addAdmin", phone: p }, "Admin added");
        setBusy(false);
        if (problem) setErr(problem); else setPhone("");
      }}>
        <label className="label" htmlFor="na">Add an admin</label>
        <div className="phone-row"><span className="cc" aria-hidden="true">+91</span><input id="na" type="tel" inputMode="numeric" maxLength={14} value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        {err && <p className="msg err" role="alert">{err}</p>}
        <Button type="submit" kind="secondary" busy={busy}>Add admin</Button>
      </form>
    </Sheet>
  );
}
