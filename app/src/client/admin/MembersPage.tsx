"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "../api";
import { Button, Chevron } from "../ui";
import { useAdmin } from "./AdminApp";
import { Icon } from "./icons";
import { Confirm, LoadError, Loading, Sheet, sayAdmin, shortDate, useLoad, useToast } from "./kit";
import { JoinForm } from "../JoinFields";
import type { MemberDetail, MembersPage as Page } from "@/lib/admin-types";
import type { FormField } from "@/lib/forms";

const AGES = [
  { v: "under8", t: "Under 8" }, { v: "8to12", t: "8 to 12" }, { v: "13to17", t: "13 to 17" }, { v: "18plus", t: "18 and over" }, { v: "unknown", t: "Age not given" },
];

function Avatar({ name, url, size = 40 }: { name: string; url: string | null; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size > 48 ? "var(--fs-28)" : undefined }} aria-hidden="true">
      {url ? <img src={url} alt="" /> : name.charAt(0).toUpperCase()}
    </span>
  );
}

/** /admin/members lists families; /admin/members?id=<profile> shows one person. */
export function MembersPage() {
  const id = useSearchParams().get("id");
  return id ? <MemberView id={id} /> : <MemberList />;
}

function MemberList() {
  const { sangh, can } = useAdmin();
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const filters = {
    class: params.get("class") ?? "", gender: params.get("gender") ?? "", age: params.get("age") ?? "", inactive: params.get("inactive") ?? "",
  };

  // Search as the admin types, a moment after they stop.
  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 300); return () => clearTimeout(t); }, [q]);

  const qs = new URLSearchParams({ s: sangh.id, ...(query ? { q: query } : {}) });
  for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v);
  const d = useLoad<Page>(`/api/admin/members?${qs}`);

  const setFilter = (k: keyof typeof filters, v: string) => {
    const next = new URLSearchParams(params.toString());
    if (v) next.set(k, v); else next.delete(k);
    router.replace(`/admin/members${next.size ? `?${next}` : ""}`, { scroll: false });
  };
  const anyFilter = Object.values(filters).some(Boolean);

  return (
    <main className="page">
      <div className="page-title"><h1 data-hi="सदस्य">Members</h1><p>Everyone who joined, by family.</p></div>
      {can("admin") && <Button kind="secondary" onClick={() => setAdding(true)}><Icon.plus />Add a member</Button>}
      {adding && <AddSheet classes={d.state === "ready" ? d.data.classes : []} onClose={() => setAdding(false)}
        onAdded={(id) => { setAdding(false); toast("Member added. They finish the join form when they first open the app."); router.push(`/admin/members?id=${id}`); }} />}
      <div className="field">
        <label className="sr-only" htmlFor="ms">Search members</label>
        <div className="phone-row" style={{ alignItems: "center" }}>
          <span style={{ display: "grid", placeItems: "center", padding: "0 var(--s-1) 0 var(--s-4)", color: "var(--ink-dim)" }} aria-hidden="true"><span style={{ width: 20, height: 20, display: "block" }}><Icon.search /></span></span>
          <input id="ms" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, phone or roll number" autoComplete="off" style={{ fontFamily: "var(--font-body)", fontSize: "var(--fs-18)", letterSpacing: 0, fontWeight: 400 }} />
        </div>
      </div>
      <div className="filters" role="group" aria-label="Filters">
        <button type="button" className="chip" aria-pressed={filters.inactive === "1"} onClick={() => setFilter("inactive", filters.inactive ? "" : "1")}>Not logged 3+ days</button>
        {d.state === "ready" && d.data.classes.length > 0 && (
          <select className="input chip" aria-label="Class" value={filters.class} onChange={(e) => setFilter("class", e.target.value)}>
            <option value="">All classes</option>
            {d.data.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <select className="input chip" aria-label="Gender" value={filters.gender} onChange={(e) => setFilter("gender", e.target.value)}>
          <option value="">Any gender</option><option value="male">Male</option><option value="female">Female</option>
        </select>
        <select className="input chip" aria-label="Age" value={filters.age} onChange={(e) => setFilter("age", e.target.value)}>
          <option value="">Any age</option>{AGES.map((a) => <option key={a.v} value={a.v}>{a.t}</option>)}
        </select>
      </div>

      {d.state === "loading" && <Loading rows={4} />}
      {d.state === "error" && <LoadError message={d.message} retry={d.retry} />}
      {d.state === "ready" && (
        <>
          <p className="hint" aria-live="polite">
            {d.data.total} {d.data.total === 1 ? "person" : "people"} in {d.data.families.length} {d.data.families.length === 1 ? "family" : "families"}
            {anyFilter && <> · <button type="button" className="btn-quiet" style={{ border: 0, background: "none", color: "var(--secondary)", cursor: "pointer", font: "inherit", padding: 0, minHeight: 0, textDecoration: "underline" }}
              onClick={() => router.replace("/admin/members", { scroll: false })}>Clear filters</button></>}
          </p>
          {d.data.families.length === 0 && (
            <div className="notice">
              <b>{query || anyFilter ? "Nobody matches" : "No members yet"}</b>
              <span>{query || anyFilter ? "Try another name or clear the filters." : <>Share your join code to bring people in. <Link href="/admin/sangh#code">Share the code</Link></>}</span>
            </div>
          )}
          {d.data.families.map((f) => (
            <div key={f.accountId} className="list family">
              <div className="family-head"><b>{f.phone}</b><span>{f.profiles.length === 1 ? "1 person" : `${f.profiles.length} people`}</span></div>
              {f.profiles.map((p) => (
                <Link key={p.id} className="row" href={`/admin/members?id=${p.id}`}>
                  <Avatar name={p.name} url={p.photoUrl} />
                  <span className="grow">
                    <span className="t">{p.name}</span>
                    <span className="s">{p.className ?? "No class"} · Last logged {shortDate(p.lastLogged)}</span>
                  </span>
                  <Chevron />
                </Link>
              ))}
            </div>
          ))}
          {d.data.truncated && <p className="hint">Showing the newest 2,000 people. Search to find someone older.</p>}
        </>
      )}
    </main>
  );
}

function MemberView({ id }: { id: string }) {
  const { can } = useAdmin();
  const router = useRouter();
  const toast = useToast();
  const d = useLoad<MemberDetail>(`/api/admin/members/${id}`);
  const [sheet, setSheet] = useState<"class" | "person" | "family" | "erase" | "edit" | null>(null);

  const back = <Link className="back" href="/admin/members" style={{ textDecoration: "none", alignSelf: "flex-start" }}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>All members</Link>;

  if (d.state === "loading") return <div className="page">{back}<Loading rows={4} /></div>;
  if (d.state === "error") return <div className="page">{back}<LoadError message={d.message} retry={d.retry} /></div>;
  const m = d.data;
  const cls = m.classes.find((c) => c.id === m.classId);
  const loggedDays = m.last30.filter((x) => x.logged).length;

  return (
    <main className="page">
      {back}
      <div style={{ display: "flex", gap: "var(--s-4)", alignItems: "center" }}>
        <Avatar name={m.name} url={m.photoUrl} size={72} />
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: "var(--fs-28)", fontWeight: 800 }}>{m.name}</h1>
          <p className="hint" style={{ fontSize: "var(--fs-16)" }}>{cls?.name ?? "No class"}{m.age !== null ? ` · ${m.age} years` : ""}</p>
        </div>
      </div>

      {m.consent.applies && (
        m.consent.given
          ? <p className="pill ok" style={{ alignSelf: "flex-start" }}>Parent&apos;s consent given{m.consent.at ? ` on ${shortDate(m.consent.at)}` : ""}</p>
          : <div className="banner warn"><b>No parent&apos;s consent on record</b><span>This person is under 18 by their date of birth. Ask the parent to add them from their own number as &ldquo;My child&rdquo;.</span></div>
      )}

      <section className="today" style={{ gap: "var(--s-3)" }} aria-label="Logging">
        <div className="big"><b>{m.streak}</b><span>{m.streak === 1 ? "day" : "days"} in a row</span></div>
        <p className="hint">Logged on {loggedDays} of the last 30 days</p>
        <div className="days" role="img" aria-label={`Logged on ${loggedDays} of the last 30 days`}>
          {m.last30.map((x) => <i key={x.date} className={x.logged ? "on" : undefined} title={`${shortDate(x.date)}${x.logged ? ": logged" : ""}`} />)}
        </div>
      </section>

      <div className="grid-2">
        <a className="btn btn-secondary" href={`tel:${m.phone.replace(/\s/g, "")}`}>Call</a>
        <a className="btn btn-secondary" href={`https://wa.me/${m.phone.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
      </div>

      <section className="section">
        <h2>Details</h2>
        <div className="card">
          <dl className="kv" style={{ margin: 0 }}>
            <dt>Phone</dt><dd>{m.phone}</dd>
            <dt>Joined</dt><dd>{shortDate(m.joinedAt)}</dd>
            <dt>Who</dt><dd>{m.relation === "self" ? "Number's owner" : "Child of the number's owner"}</dd>
            {m.answers.map((a) => <FragmentKV key={a.key} k={a.label} v={a.value} />)}
          </dl>
        </div>
      </section>

      {m.family.length > 1 && (
        <section className="section">
          <h2>Same family</h2>
          <div className="list">
            {m.family.filter((p) => p.id !== m.id).map((p) => (
              <Link key={p.id} className="row" href={`/admin/members?id=${p.id}`}><Avatar name={p.name} url={null} /><span className="grow"><span className="t">{p.name}</span></span><Chevron /></Link>
            ))}
          </div>
        </section>
      )}

      <div className="stack">
        {can("setup") && <Button kind="secondary" onClick={() => setSheet("edit")}>Edit details</Button>}
        {can("setup") && <Button kind="secondary" onClick={() => setSheet("class")}>Change class</Button>}
        {can("remove_members") && <Button kind="quiet" onClick={() => setSheet("person")}><span style={{ color: "var(--danger)" }}>Remove {m.name}</span></Button>}
        {can("remove_members") && <Button kind="quiet" onClick={() => setSheet("family")}><span style={{ color: "var(--danger)" }}>Remove the whole family</span></Button>}
      </div>

      {can("admin") && <section className="section" aria-labelledby="data-h">
        <h2 id="data-h">Family&apos;s data request</h2>
        <p className="hint">Use these only when the family asks for a copy of its data, or asks for it to be deleted.</p>
        <div className="stack">
          <a className="btn btn-secondary" href={`/api/admin/families/${m.accountId}/data`} download>Download the family&apos;s data</a>
          <Button kind="quiet" onClick={() => setSheet("erase")}><span style={{ color: "var(--danger)" }}>Delete the family&apos;s data now</span></Button>
        </div>
      </section>}

      {sheet === "edit" && <EditSheet id={m.id} onClose={() => setSheet(null)} onSaved={(x) => { d.set(x); setSheet(null); toast("Details saved"); }} />}
      {sheet === "class" && (
        <Sheet title={`Move ${m.name} to`} onClose={() => setSheet(null)}>
          <div className="stack" role="radiogroup" aria-label="Class">
            {m.classes.map((c) => (
              <button key={c.id} type="button" role="radio" aria-checked={c.id === m.classId} className="choice"
                onClick={async () => {
                  if (c.id === m.classId) { setSheet(null); return; }
                  const r = await api<MemberDetail>(`/api/admin/members/${m.id}`, { method: "PATCH", body: { classId: c.id } });
                  if (r.ok) { d.set(r.data); setSheet(null); toast(`${m.name} moved to ${c.name}`); } else toast(sayAdmin(r.err));
                }}>
                <span className="radio-dot" aria-hidden="true" /><span className="grow"><span className="t">{c.name}</span></span>
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {sheet === "person" && (
        <Confirm title={`Remove ${m.name}?`} action={`Remove ${m.name}`} onClose={() => setSheet(null)}
          body={<><p>{m.name} leaves the pathshala. The rest of the family stays.</p><p>Their record is hidden now and deleted after 30 days.</p></>}
          onConfirm={async () => {
            const r = await api(`/api/admin/members/${m.id}`, { method: "DELETE", body: {} });
            if (!r.ok) return sayAdmin(r.err);
            toast(`${m.name} removed`); router.replace("/admin/members");
            return null;
          }} />
      )}
      {sheet === "family" && (
        <Confirm title="Remove the whole family?" action="Remove family" onClose={() => setSheet(null)}
          body={<>
            <p>Everyone on <b>{m.phone}</b> leaves the pathshala{m.family.length > 1 ? `: ${m.family.map((p) => p.name).join(", ")}` : ""}.</p>
            <p>The number is freed at once, so it can join another pathshala. Their records are hidden now and deleted after 30 days.</p>
          </>}
          onConfirm={async () => {
            const r = await api(`/api/admin/families/${m.accountId}`, { method: "DELETE", body: {} });
            if (!r.ok) return sayAdmin(r.err);
            toast("Family removed"); router.replace("/admin/members");
            return null;
          }} />
      )}
      {sheet === "erase" && (
        <Confirm title="Delete all of this family's data?" action="Delete everything now" onClose={() => setSheet(null)}
          body={<>
            <p>Everyone on <b>{m.phone}</b>{m.family.length > 1 ? ` (${m.family.map((p) => p.name).join(", ")})` : ""} and all their niyam logs are deleted <b>at once</b>.</p>
            <p>This cannot be undone. Do it only when the family has asked for it.</p>
          </>}
          onConfirm={async () => {
            const r = await api(`/api/admin/families/${m.accountId}/erase`, { body: {} });
            if (!r.ok) return sayAdmin(r.err);
            toast("Family's data deleted"); router.replace("/admin/members");
            return null;
          }} />
      )}
    </main>
  );
}

function FragmentKV({ k, v }: { k: string; v: string }) {
  return <><dt>{k}</dt><dd>{v}</dd></>;
}

/** Correct a member's name and join-form answers (a wrong date of birth, a new area). */
function EditSheet({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved: (m: MemberDetail) => void }) {
  const d = useLoad<{ name: string; fields: FormField[]; answers: Record<string, string> }>(`/api/admin/members/${id}/details`);
  const [name, setName] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string> | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Sheet title="Edit details" onClose={onClose}>
      {d.state === "loading" && <Loading rows={3} />}
      {d.state === "error" && <LoadError message={d.message} retry={d.retry} />}
      {d.state === "ready" && (
        <form className="stack-lg" noValidate onSubmit={async (e) => {
          e.preventDefault();
          const nm = (name ?? d.data.name).trim();
          if (!nm) { setErr("Write the name."); return; }
          setBusy(true); setErr(null);
          const r = await api<MemberDetail>(`/api/admin/members/${id}/details`, { method: "PUT", body: { name: nm, answers: answers ?? d.data.answers } });
          setBusy(false);
          if (r.ok) onSaved(r.data);
          else if (r.err.error === "invalid_answers") { setErrors(r.err.fields ?? {}); setErr("Some answers need a fix. See above."); }
          else setErr(sayAdmin(r.err));
        }}>
          <div className="field"><label className="label" htmlFor="en">Name</label>
            <input id="en" className="input" maxLength={60} value={name ?? d.data.name} onChange={(e) => setName(e.target.value)} /></div>
          <JoinForm fields={d.data.fields} classes={[]} values={{ classId: null, photoUrl: null, answers: answers ?? d.data.answers }} errors={errors}
            onChange={(v, touched) => { setAnswers(v.answers); setErrors((x) => { const { [touched]: _, ...rest } = x; void _; return rest; }); }} />
          {err && <p className="msg err" role="alert">{err}</p>}
          <Button type="submit" busy={busy}>{busy ? "Saving…" : "Save details"}</Button>
        </form>
      )}
    </Sheet>
  );
}

/** Admins add someone who can't join on their own phone: a code goes to their number, they read it out. */
function AddSheet({ classes, onClose, onAdded }: { classes: { id: string; name: string }[]; onClose: () => void; onAdded: (profileId: string) => void }) {
  const [f, setF] = useState({ name: "", phone: "", classId: classes[0]?.id ?? null as string | null, code: "" });
  const [sent, setSent] = useState<{ simulated: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const up = (p: Partial<typeof f>) => { setF((x) => ({ ...x, ...p })); setErr(null); };

  async function send() {
    if (!f.name.trim()) { setErr("Write their name."); return; }
    if (f.phone.replace(/\D/g, "").length < 10) { setErr("Enter their 10-digit mobile number."); return; }
    setBusy(true);
    const r = await api<{ simulated: boolean }>("/api/admin/members/add", { body: { step: "send", phone: f.phone } });
    setBusy(false);
    if (r.ok) setSent(r.data); else setErr(sayAdmin(r.err));
  }
  async function confirm() {
    if (f.code.length < 4) { setErr("Type the code they read out to you."); return; }
    setBusy(true);
    const r = await api<{ profileId: string }>("/api/admin/members/add", { body: { step: "confirm", phone: f.phone, code: f.code, name: f.name.trim(), classId: f.classId } });
    setBusy(false);
    if (r.ok) onAdded(r.data.profileId); else setErr(sayAdmin(r.err));
  }

  return (
    <Sheet title="Add a member" onClose={onClose}>
      <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); void (sent ? confirm() : send()); }}>
        {!sent ? (
          <>
            <p>For someone who can&apos;t join on their own phone. A code goes to their number; ask them to read it out to you.</p>
            <div className="field"><label className="label" htmlFor="an">Name</label>
              <input id="an" className="input" maxLength={60} value={f.name} onChange={(e) => up({ name: e.target.value })} /></div>
            <div className="field"><label className="label" htmlFor="ap">Their mobile number</label>
              <div className="phone-row"><span className="cc" aria-hidden="true">+91</span>
                <input id="ap" type="tel" inputMode="numeric" maxLength={14} value={f.phone} onChange={(e) => up({ phone: e.target.value })} /></div></div>
            {classes.length > 0 && (
              <div className="field"><span className="label">Class</span>
                <div className="chips">{classes.map((c) => <button key={c.id} type="button" className="chip" aria-pressed={f.classId === c.id} onClick={() => up({ classId: c.id })}>{c.name}</button>)}</div></div>
            )}
          </>
        ) : (
          <>
            <p>We sent a code to <b>+91 {f.phone.replace(/\D/g, "").slice(-10)}</b>. Ask {f.name.trim()} to read it out to you.</p>
            {sent.simulated && <p className="hint">Test mode: the code is 1234.</p>}
            <div className="field"><label className="label" htmlFor="ac">Code</label>
              <input id="ac" className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={f.code} onChange={(e) => up({ code: e.target.value.replace(/\D/g, "") })} /></div>
          </>
        )}
        {err && <p className="msg err" role="alert">{err}</p>}
        <Button type="submit" busy={busy}>{busy ? "Please wait…" : sent ? "Add member" : "Send code"}</Button>
        {sent && <Button kind="quiet" onClick={() => { setSent(null); up({ code: "" }); }}>Change the number</Button>}
      </form>
    </Sheet>
  );
}
