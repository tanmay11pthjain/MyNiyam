"use client";
import Link from "next/link";
import { api } from "../api";
import { Button, Chevron } from "../ui";
import { useAdmin } from "./AdminApp";
import { Icon } from "./icons";
import { Switch } from "./kit";
import { readPrefs, savePrefs } from "../prefs";
import { useState } from "react";

/** The Setup tab: everything that shapes the pathshala, one row each. */
export function SetupHub() {
  const { me, sangh, can } = useAdmin();
  const [hi, setHi] = useState(() => (typeof window === "undefined" ? false : readPrefs().adminHi));
  const rows = [
    ...(can("admin") ? [{ href: "/admin/sangh", icon: Icon.qr, t: "Pathshala and join code", s: "Code, QR, poster, details, who can join" }] : []),
    ...(can("setup") ? [
      { href: "/admin/classes", icon: Icon.layers, t: "Classes", s: "Add, order and hide classes" },
      { href: "/admin/form", icon: Icon.form, t: "Join form", s: "What new members are asked" },
    ] : []),
    ...(can("admin") ? [{ href: "/admin/volunteers", icon: Icon.people, t: "Volunteers and teachers", s: "Who helps, with which classes, and the activity log" }] : []),
    ...(me.isSuper ? [{ href: "/admin/super", icon: Icon.shield, t: "Super admin", s: "Approve pathshalas and their admins" }] : []),
  ];
  return (
    <main className="page">
      <div className="page-title"><h1 data-hi="सेटअप">Setup</h1><p>{sangh.name}{sangh.role === "volunteer" ? " · you are a volunteer here" : ""}</p></div>
      {rows.length === 0 && <p className="hint">Nothing to set up with your access. Ask the pathshala&apos;s admin if you need more.</p>}
      <nav className="list" aria-label="Setup">
        {rows.map((r) => (
          <Link key={r.href} className="row" href={r.href}>
            <span className="niyam-icon"><r.icon /></span>
            <span className="grow"><span className="t">{r.t}</span><span className="s">{r.s}</span></span>
            <Chevron />
          </Link>
        ))}
      </nav>
      <div className="list">
        <Switch label="Hindi labels · हिंदी नाम" sub="Show Hindi names beside the English ones, on this phone." checked={hi} onChange={(v) => setHi(savePrefs({ adminHi: v }).adminHi)} />
      </div>
      <div className="push stack">
        <p className="hint center">Signed in as {me.phone}</p>
        <Button kind="quiet" onClick={async () => { await api("/api/admin/session", { method: "DELETE", body: {} }); window.location.replace("/admin/login"); }}>Log out</Button>
      </div>
    </main>
  );
}
