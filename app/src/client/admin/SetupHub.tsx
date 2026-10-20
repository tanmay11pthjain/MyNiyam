"use client";
import Link from "next/link";
import { api } from "../api";
import { Button, Chevron } from "../ui";
import { useAdmin } from "./AdminApp";
import { Icon } from "./icons";

/** The Setup tab: everything that shapes the pathshala, one row each. */
export function SetupHub() {
  const { me, sangh } = useAdmin();
  const rows = [
    { href: "/admin/sangh", icon: Icon.qr, t: "Pathshala and join code", s: "Code, QR, poster, details, who can join" },
    { href: "/admin/classes", icon: Icon.layers, t: "Classes", s: "Add, order and hide classes" },
    { href: "/admin/form", icon: Icon.form, t: "Join form", s: "What new members are asked" },
    ...(me.isSuper ? [{ href: "/admin/super", icon: Icon.shield, t: "Super admin", s: "Approve pathshalas and their admins" }] : []),
  ];
  return (
    <main className="page">
      <div className="page-title"><h1>Setup</h1><p>{sangh.name}</p></div>
      <nav className="list" aria-label="Setup">
        {rows.map((r) => (
          <Link key={r.href} className="row" href={r.href}>
            <span className="niyam-icon"><r.icon /></span>
            <span className="grow"><span className="t">{r.t}</span><span className="s">{r.s}</span></span>
            <Chevron />
          </Link>
        ))}
      </nav>
      <div className="push stack">
        <p className="hint center">Signed in as {me.phone}</p>
        <Button kind="quiet" onClick={async () => { await api("/api/admin/session", { method: "DELETE", body: {} }); window.location.replace("/admin/login"); }}>Log out</Button>
      </div>
    </main>
  );
}
