"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api } from "../api";
import { Button, Chevron, SanghLogo } from "../ui";
import { Icon } from "./icons";
import { applyPrefs } from "../prefs";
import { LoadError, Loading, Sheet, ToastHost, sayAdmin, useLoad, useToast } from "./kit";
import type { AdminMe, AdminSangh, Perm } from "@/lib/admin-types";

type Can = (p: Perm | "admin") => boolean;
type AdminState = { me: AdminMe; sangh: AdminSangh; refresh: () => void; can: Can };
const Ctx = createContext<AdminState | null>(null);

/** The signed-in admin and their open sangh. Only inside pages that AdminApp has let through. */
export function useAdmin(): AdminState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAdmin outside AdminApp");
  return v;
}

/** What this phone may do in the open sangh. Admins may do everything; the server checks again. */
export const canFor = (sangh: AdminSangh | null): Can => (p) => !!sangh && (sangh.role === "admin" || (p !== "admin" && sangh.perms.includes(p)));

const TABS: { href: string; label: string; hi?: string; icon: () => ReactNode; match: (p: string) => boolean; show: (can: Can) => boolean }[] = [
  { href: "/admin", label: "Home", hi: "मुख्य", icon: Icon.home, match: (p: string) => p === "/admin" || ["/admin/announcements", "/admin/reports", "/admin/goals", "/admin/leaderboard"].some((x) => p.startsWith(x)), show: () => true },
  { href: "/admin/members", label: "Members", hi: "सदस्य", icon: Icon.people, match: (p: string) => p.startsWith("/admin/members"), show: (can) => can("view_members") },
  { href: "/admin/attendance", label: "Attendance", hi: "हाज़िरी", icon: Icon.roll, match: (p: string) => p.startsWith("/admin/attendance"), show: (can) => can("attendance") },
  { href: "/admin/niyams", label: "Niyams", hi: "नियम", icon: Icon.niyam, match: (p: string) => p.startsWith("/admin/niyams"), show: (can) => can("niyams") },
  { href: "/admin/setup", label: "Setup", hi: "सेटअप", icon: Icon.setup, match: (p: string) => ["/admin/setup", "/admin/sangh", "/admin/classes", "/admin/form", "/admin/super", "/admin/volunteers"].some((x) => p.startsWith(x)), show: () => true },
];

/** Wraps every /admin page: checks the session, opens a sangh, and draws the header and tabs. */
export function AdminApp({ children }: { children: ReactNode }) {
  const path = usePathname();
  if (path === "/admin/login") return <ToastHost>{children}</ToastHost>;
  return <ToastHost><Gate path={path}>{children}</Gate></ToastHost>;
}

function Gate({ path, children }: { path: string; children: ReactNode }) {
  const me = useLoad<AdminMe>("/api/admin/session"); // the server opens a sangh if none is open

  if (me.state === "loading") return <div className="admin bare"><div className="page"><Loading /></div></div>;
  if (me.state === "error") return <div className="admin bare"><div className="page"><LoadError message={me.message} retry={me.retry} /></div></div>;

  const data = me.data;
  const sangh = data.sanghs.find((s) => s.id === data.activeSanghId) ?? null;
  const bare = path === "/admin/sangh/poster";

  // The super admin's page works without a sangh of their own.
  if (path.startsWith("/admin/super")) {
    if (!data.isSuper) return <div className="admin bare"><div className="page"><div className="banner err">This page is for the MyNiyam super admin only.</div><Link href="/admin">Back to admin home</Link></div></div>;
    const placeholder: AdminSangh = sangh ?? { id: "", name: "No pathshala open", city: "", status: "active", role: "admin", perms: [] };
    return (
      <Ctx.Provider value={{ me: data, sangh: placeholder, refresh: me.reload, can: canFor(sangh) }}>
        <Chrome path={path} me={data} sangh={sangh} onChanged={me.set} noTabs={!sangh}>{children}</Chrome>
      </Ctx.Provider>
    );
  }

  if (!sangh && data.isSuper) {
    // The super admin who runs no pathshala of their own: one clear way in.
    return (
      <Chrome path={path} me={data} sangh={null} onChanged={me.set} noTabs>
        <div className="page">
          <div className="page-title"><h1>Welcome</h1><p>You are the MyNiyam super admin.</p></div>
          <Link className="btn btn-primary" href="/admin/super">Approve and add pathshalas</Link>
          <p className="hint">To run a pathshala yourself, add your own number as its admin there.</p>
        </div>
      </Chrome>
    );
  }
  if (!sangh) return <div className="admin bare"><NoSangh me={data} onChanged={me.set} /></div>;
  if (sangh.status === "pending") {
    return (
      <Chrome path={path} me={data} sangh={sangh} onChanged={me.set} noTabs>
        <div className="page">
          <div className="page-title"><h1>Waiting for approval</h1><p>{sangh.name}, {sangh.city}</p></div>
          <div className="notice"><b>Your request has reached MyNiyam.</b><span>Once it is approved, this pathshala gets its join code and you can set it up here. Nothing else to do for now.</span></div>
          {data.isSuper && <Link className="btn btn-secondary" href="/admin/super">Open super admin</Link>}
        </div>
      </Chrome>
    );
  }

  return (
    <Ctx.Provider value={{ me: data, sangh, refresh: me.reload, can: canFor(sangh) }}>
      {bare ? <div className="admin bare">{children}</div> : <Chrome path={path} me={data} sangh={sangh} onChanged={me.set}>{children}</Chrome>}
    </Ctx.Provider>
  );
}

function Chrome({ path, me, sangh, onChanged, noTabs, children }: {
  path: string; me: AdminMe; sangh: AdminSangh | null; onChanged: (m: AdminMe) => void; noTabs?: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [menuAt, setMenuAt] = useState<string | null>(null); // the menu closes by itself when a page opens
  const [scrolled, setScrolled] = useState(false);
  const wide = path.startsWith("/admin/form");
  useEffect(() => {
    applyPrefs();
    const on = () => setScrolled(window.scrollY > 4);
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <div className={`admin${wide ? " wide" : ""}${noTabs ? " bare" : ""}`}>
      <header className={`admin-bar${scrolled ? " scrolled" : ""}`}>
        <button type="button" className="switcher" onClick={() => setOpen(true)} aria-haspopup="dialog">
          <SanghLogo name={sangh?.name ?? "M"} url={null} />
          <span style={{ minWidth: 0 }}>
            <span className="nm">{sangh?.name ?? "MyNiyam admin"}</span>
            <span className="sub">{me.sanghs.length > 1 ? "Switch pathshala" : sangh?.role === "volunteer" ? "Volunteer" : "Admin"}{me.isSuper ? " · super admin" : ""}</span>
          </span>
          <Chevron />
        </button>
        {!noTabs && sangh && (
          <button type="button" className="menu-btn" onClick={() => setMenuAt(path)} aria-haspopup="dialog" aria-label="Menu: all features">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
        )}
      </header>
      {children}
      {!noTabs && (
        <div className="tabbar">
          <nav aria-label="Admin sections">
            {TABS.filter((t) => t.show(canFor(sangh))).map((t) => (
              <Link key={t.href} href={t.href} aria-current={t.match(path) ? "page" : undefined}><t.icon />{t.label}<span className="tab-hi" lang="hi">{t.hi}</span></Link>
            ))}
          </nav>
        </div>
      )}
      {menuAt === path && sangh && <MenuSheet me={me} can={canFor(sangh)} path={path} onClose={() => setMenuAt(null)} />}
      {open && <SwitchSheet me={me} onClose={() => setOpen(false)} onChanged={(m) => { onChanged(m); setOpen(false); }} />}
    </div>
  );
}

/** The top-right menu: every feature, in plain words, one tap away. Shows only what this phone may do. */
function MenuSheet({ me, can, path, onClose }: { me: AdminMe; can: Can; path: string; onClose: () => void }) {
  const groups: { h: string; items: { href: string; icon: () => ReactNode; t: string; show: boolean }[] }[] = [
    { h: "Every day", items: [
      { href: "/admin", icon: Icon.home, t: "Home", show: true },
      { href: "/admin/attendance", icon: Icon.roll, t: "Take attendance", show: can("attendance") },
      { href: "/admin/members", icon: Icon.people, t: "Members", show: can("view_members") },
      { href: "/admin/announcements", icon: Icon.megaphone, t: "Announcements", show: can("announcements") },
      { href: "/admin/leaderboard", icon: Icon.trophy, t: "Leaderboard and poster", show: can("view_members") },
    ] },
    { h: "Niyams and progress", items: [
      { href: "/admin/niyams", icon: Icon.niyam, t: "Niyams", show: can("niyams") },
      { href: "/admin/goals", icon: Icon.layers, t: "Goals and challenges", show: can("niyams") },
      { href: "/admin/reports", icon: Icon.download, t: "Reports and Excel", show: can("view_members") },
    ] },
    { h: "Setup", items: [
      { href: "/admin/sangh", icon: Icon.qr, t: "Pathshala and join code", show: can("admin") },
      { href: "/admin/classes", icon: Icon.layers, t: "Classes", show: can("setup") },
      { href: "/admin/form", icon: Icon.form, t: "Join form", show: can("setup") },
      { href: "/admin/volunteers", icon: Icon.people, t: "Volunteers and teachers", show: can("admin") },
      { href: "/admin/setup", icon: Icon.setup, t: "All settings", show: true },
      { href: "/admin/super", icon: Icon.shield, t: "Super admin", show: me.isSuper },
    ] },
  ];
  return (
    <Sheet title="Menu" onClose={onClose}>
      <nav className="menu" aria-label="All features">
        {groups.map((gr) => {
          const items = gr.items.filter((i) => i.show);
          return items.length ? (
            <div key={gr.h}>
              <h3>{gr.h}</h3>
              <div className="list">
                {items.map((i) => (
                  <Link key={i.href} className="row" href={i.href} onClick={path === i.href ? onClose : undefined} aria-current={path === i.href || undefined}>
                    <span className="niyam-icon"><i.icon /></span><span className="grow"><span className="t">{i.t}</span></span><Chevron />
                  </Link>
                ))}
              </div>
            </div>
          ) : null;
        })}
      </nav>
    </Sheet>
  );
}

function SwitchSheet({ me, onClose, onChanged }: { me: AdminMe; onClose: () => void; onChanged: (m: AdminMe) => void }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <Sheet title="Your pathshalas" onClose={onClose}>
      <div className="list">
        {me.sanghs.map((s) => (
          <button key={s.id} type="button" className="row" aria-current={s.id === me.activeSanghId || undefined} disabled={busy !== null}
            onClick={async () => {
              if (s.id === me.activeSanghId) { onClose(); return; }
              setBusy(s.id);
              const r = await api<AdminMe>("/api/admin/session", { method: "PUT", body: { sanghId: s.id } });
              setBusy(null);
              if (r.ok) { onChanged(r.data); router.push("/admin"); toast(`Opened ${s.name}`); } else toast(sayAdmin(r.err));
            }}>
            <SanghLogo name={s.name} url={null} />
            <span className="grow"><span className="t">{s.name}</span><span className="s">{s.city}{s.role === "volunteer" ? " · volunteer" : ""}{s.status === "pending" ? " · waiting for approval" : ""}</span></span>
            {busy === s.id ? <span className="spinner" aria-hidden="true" /> : s.id === me.activeSanghId ? <span className="pill ok">Open</span> : <Chevron />}
          </button>
        ))}
      </div>
      <p className="hint">Signed in as {me.phone}</p>
      <div className="stack">
        {me.isSuper && <Link className="btn btn-secondary" href="/admin/super" onClick={onClose}>Super admin: approve pathshalas</Link>}
        <Button kind="quiet" onClick={async () => { await api("/api/admin/session", { method: "DELETE", body: {} }); window.location.replace("/admin/login"); }}>Log out</Button>
      </div>
    </Sheet>
  );
}

/** Signed in, but this number runs no sangh yet: ask for one (the super admin approves it). */
function NoSangh({ me, onChanged }: { me: AdminMe; onChanged: (m: AdminMe) => void }) {
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="page">
      <div className="page-title"><h1>No pathshala yet</h1><p>{me.phone} isn&apos;t an admin of any pathshala.</p></div>
      <div className="notice"><b>Already run one?</b><span>Ask MyNiyam to add this number as its admin.</span></div>
      <form className="stack" noValidate onSubmit={async (e) => {
        e.preventDefault();
        if (name.trim().length < 2 || city.trim().length < 2) { setErr("Write the pathshala's name and city."); return; }
        setBusy(true); setErr(null);
        const r = await api<AdminMe>("/api/admin/request", { body: { name: name.trim(), city: city.trim() } });
        setBusy(false);
        if (r.ok) onChanged(r.data); else setErr(sayAdmin(r.err));
      }}>
        <h2 style={{ fontSize: "var(--fs-22)" }}>Start a new pathshala</h2>
        <div className="field"><label className="label" htmlFor="rn">Pathshala name</label><input id="rn" className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label className="label" htmlFor="rc">City</label><input id="rc" className="input" value={city} maxLength={80} onChange={(e) => setCity(e.target.value)} /></div>
        {err && <p className="msg err" role="alert">{err}</p>}
        <Button type="submit" busy={busy}>{busy ? "Sending…" : "Send request"}</Button>
        <p className="hint">MyNiyam checks each new pathshala before it can take members.</p>
      </form>
      <div className="stack push">
        {me.isSuper && <Link className="btn btn-secondary" href="/admin/super">Open super admin</Link>}
        <Button kind="quiet" onClick={async () => { await api("/api/admin/session", { method: "DELETE", body: {} }); window.location.replace("/admin/login"); }}>Log out</Button>
      </div>
    </div>
  );
}
