"use client";
import { useState } from "react";
import { api } from "../api";
import { Button } from "../ui";
import { useAdmin } from "./AdminApp";
import { Icon } from "./icons";
import { Confirm, LoadError, Loading, Sheet, Switch, UpDown, move, sayAdmin, shortDate, shrinkImage, upload, useLoad, useToast } from "./kit";
import type { Announcement, AnnouncementInput, AnnouncementsPage as Page } from "@/lib/admin-types";

const BLANK: AnnouncementInput = {
  title: "", body: null, imageUrl: null, buttonLabel: null, buttonUrl: null, allClasses: true, classIds: [],
  startDate: null, endDate: null, pinned: false,
};

const STATE: Record<Announcement["state"], { t: string; c: string }> = {
  live: { t: "Showing now", c: "ok" }, scheduled: { t: "Starts later", c: "warn" }, ended: { t: "Ended", c: "" },
};

function when(a: Announcement): string {
  if (a.startDate && a.endDate) return `${shortDate(a.startDate)} to ${shortDate(a.endDate)}`;
  if (a.startDate) return `From ${shortDate(a.startDate)}`;
  if (a.endDate) return `Until ${shortDate(a.endDate)}`;
  return "No end date";
}

/** Announcements: picture slides on members' Sangh tab. Members see up to 6 at a time, pinned first. */
export function AnnouncementsPage() {
  const { sangh } = useAdmin();
  const toast = useToast();
  const d = useLoad<Page>(`/api/admin/announcements?s=${sangh.id}`);
  const [editing, setEditing] = useState<{ a: Announcement | null; draft: AnnouncementInput } | null>(null);

  if (d.state === "loading") return <div className="page"><Loading rows={3} /></div>;
  if (d.state === "error") return <div className="page"><LoadError message={d.message} retry={d.retry} /></div>;
  const page = d.data;
  const { reload } = d;
  const set = (announcements: Announcement[]) => d.set({ ...page, announcements });
  const current = page.announcements.filter((a) => a.state !== "ended");
  const ended = page.announcements.filter((a) => a.state === "ended");
  const classNames = new Map(page.classes.map((c) => [c.id, c.name]));

  async function reorder(from: number, to: number) {
    const next = [...move(current, from, to), ...ended];
    set(next);
    const r = await api<{ announcements: Announcement[] }>("/api/admin/announcements", { method: "PUT", body: { ids: next.map((a) => a.id) } });
    if (r.ok) set(r.data.announcements); else { toast(sayAdmin(r.err)); reload(); }
  }

  const row = (a: Announcement, i: number, movable: boolean) => (
    <div key={a.id} className={`row${a.state === "ended" ? " dim" : ""}`}>
      <button type="button" className="grow" style={{ display: "flex", gap: "var(--s-3)", alignItems: "center", border: 0, background: "none", textAlign: "left", padding: "var(--s-2) 0", cursor: "pointer", minWidth: 0, color: "inherit" }}
        onClick={() => setEditing({ a, draft: { ...a } })}>
        <span className="niyam-icon"><Icon.megaphone /></span>
        <span style={{ minWidth: 0 }}>
          <span className="t">{a.title}{a.pinned && <span className="pill kesar" style={{ marginLeft: 8 }}>Pinned</span>}</span>
          <span className="s">
            <span className={`pill ${STATE[a.state].c}`} style={{ marginRight: 6 }}>{STATE[a.state].t}</span>
            {when(a)} · {a.allClasses ? "Everyone" : a.classIds.map((c) => classNames.get(c)).filter(Boolean).join(", ")} · Seen by {a.views}
          </span>
        </span>
      </button>
      {movable && current.length > 1 && <UpDown index={i} count={current.length} onMove={reorder} label={a.title} />}
    </div>
  );

  return (
    <main className="page">
      <div className="page-title"><h1 data-hi="घोषणाएँ">Announcements</h1><p>Picture slides on members&apos; Sangh tab, up to 6 at a time. The pinned one comes first.</p></div>
      <Button onClick={() => setEditing({ a: null, draft: { ...BLANK } })}><Icon.plus />New announcement</Button>
      {page.announcements.length === 0 && (
        <div className="notice"><b>No announcements yet</b><span>Post a notice, an event or a registration link, for everyone or for one class.</span></div>
      )}
      {current.length > 0 && <div className="list">{current.map((a, i) => row(a, i, true))}</div>}
      {ended.length > 0 && (
        <section className="section"><h2>Ended</h2><div className="list">{ended.map((a, i) => row(a, i, false))}</div></section>
      )}
      {editing && <Editor key={editing.a?.id ?? "new"} a={editing.a} initial={editing.draft} page={page}
        onClose={() => setEditing(null)} onSaved={(list, msg) => { set(list); setEditing(null); toast(msg); }} />}
    </main>
  );
}

function Editor({ a, initial, page, onClose, onSaved }: {
  a: Announcement | null; initial: AnnouncementInput; page: Page; onClose: () => void; onSaved: (list: Announcement[], msg: string) => void;
}) {
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [del, setDel] = useState(false);
  const up = (p: Partial<AnnouncementInput>) => { setF((x) => ({ ...x, ...p })); setErr(null); };
  const hasButton = f.buttonLabel !== null || f.buttonUrl !== null;

  function problem(): string | null {
    if (!f.title.trim()) return "Write a title.";
    if (!f.imageUrl) return "Add a picture. Every announcement needs one.";
    if (hasButton && (!f.buttonLabel?.trim() || !f.buttonUrl?.trim())) return "Write both the button's words and its link, or remove the button.";
    if (hasButton && !/^https:\/\/\S+\.\S+$/.test(f.buttonUrl!.trim())) return "The link must start with https://";
    if (f.startDate && f.endDate && f.startDate > f.endDate) return "The end date is before the start date.";
    if (!f.allClasses && f.classIds.length === 0) return "Pick at least one class.";
    return null;
  }

  async function save() {
    const p = problem();
    if (p) { setErr(p); return; }
    setBusy(true);
    const body = { ...f, buttonLabel: hasButton ? f.buttonLabel : null, buttonUrl: hasButton ? f.buttonUrl!.trim() : null };
    const r = a
      ? await api<{ announcements: Announcement[] }>(`/api/admin/announcements/${a.id}`, { method: "PUT", body })
      : await api<{ announcements: Announcement[] }>("/api/admin/announcements", { body });
    setBusy(false);
    if (r.ok) onSaved(r.data.announcements, a ? "Announcement saved" : "Announcement posted"); else setErr(sayAdmin(r.err));
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    setUploading(true); setErr(null);
    try {
      const r = await upload<{ imageUrl: string }>("/api/admin/announcements/image", await shrinkImage(file, 1280, 16 / 9));
      if (r.ok) up({ imageUrl: r.data.imageUrl }); else setErr(sayAdmin(r.err));
    } catch {
      setErr("That picture couldn't be read. Try another one.");
    }
    setUploading(false);
  }

  if (del && a) {
    return (
      <Confirm title="Delete this announcement?" action="Delete" onClose={() => setDel(false)}
        body={<p>&ldquo;{a.title}&rdquo; disappears from members&apos; Sangh tab.</p>}
        onConfirm={async () => {
          const r = await api<{ announcements: Announcement[] }>(`/api/admin/announcements/${a.id}`, { method: "DELETE", body: {} });
          if (!r.ok) return sayAdmin(r.err);
          onSaved(r.data.announcements, "Announcement deleted");
          return null;
        }} />
    );
  }

  return (
    <Sheet title={a ? "Edit announcement" : "New announcement"} onClose={onClose}>
      <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className="field"><label className="label" htmlFor="at">Title</label>
          <input id="at" className="input" value={f.title} maxLength={60} placeholder="e.g. Paryushan shibir registration" onChange={(e) => up({ title: e.target.value })} /></div>
        <div className="field"><label className="label" htmlFor="ab">Short text <span className="opt">(optional)</span></label>
          <textarea id="ab" className="input" rows={3} value={f.body ?? ""} maxLength={200} onChange={(e) => up({ body: e.target.value || null })} /></div>

        <div className="field">
          <span className="label">Picture</span>
          <span className="hint">A wide picture (16:9). We trim it to fit.</span>
          {f.imageUrl && <img src={f.imageUrl} alt="" style={{ width: "100%", aspectRatio: "16 / 9", objectFit: "cover", borderRadius: "var(--r-m)" }} />}
          <label className={`btn btn-${f.imageUrl ? "quiet" : "secondary"}`} style={{ cursor: "pointer" }}>
            {uploading ? "Uploading…" : f.imageUrl ? "Change picture" : "Add a picture"}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={uploading} onChange={(e) => void pick(e.target.files?.[0])} />
          </label>
        </div>

        <Switch label="Add a button" sub="For example a registration form link." checked={hasButton}
          onChange={(v) => up(v ? { buttonLabel: "", buttonUrl: "https://" } : { buttonLabel: null, buttonUrl: null })} />
        {hasButton && (
          <>
            <div className="field"><label className="label" htmlFor="abl">Button words</label>
              <input id="abl" className="input" value={f.buttonLabel ?? ""} maxLength={30} placeholder="e.g. Register" onChange={(e) => up({ buttonLabel: e.target.value })} /></div>
            <div className="field"><label className="label" htmlFor="abu">Link</label>
              <input id="abu" className="input" type="url" inputMode="url" value={f.buttonUrl ?? ""} maxLength={500} onChange={(e) => up({ buttonUrl: e.target.value })} /></div>
          </>
        )}

        <div className="field">
          <span className="label">Who sees it</span>
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

        <div className="btn-row">
          <div className="field"><label className="label" htmlFor="as">Show from <span className="opt">(optional)</span></label>
            <input id="as" type="date" className="input" value={f.startDate ?? ""} onChange={(e) => up({ startDate: e.target.value || null })} /></div>
          <div className="field"><label className="label" htmlFor="ae">Until <span className="opt">(optional)</span></label>
            <input id="ae" type="date" className="input" value={f.endDate ?? ""} min={f.startDate ?? page.today} onChange={(e) => up({ endDate: e.target.value || null })} /></div>
        </div>

        <Switch label="Pin first" sub="Only one announcement can be pinned. Pinning this unpins the other." checked={f.pinned} onChange={(v) => up({ pinned: v })} />

        {err && <p className="msg err" role="alert">{err}</p>}
        <Button type="submit" busy={busy} disabled={uploading}>{a ? "Save" : "Post announcement"}</Button>
        {a && <Button kind="quiet" onClick={() => setDel(true)}><span style={{ color: "var(--danger)" }}>Delete announcement</span></Button>}
      </form>
    </Sheet>
  );
}

