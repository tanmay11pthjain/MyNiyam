"use client";
import Link from "next/link";
import { useAdmin } from "./AdminApp";
import { Icon } from "./icons";
import { LoadError, Loading, useLoad } from "./kit";
import type { Checklist, Dashboard } from "@/lib/admin-types";

const STEPS: { key: keyof Checklist; label: string; href: string }[] = [
  { key: "classes", label: "Add your classes", href: "/admin/classes" },
  { key: "form", label: "Choose what the join form asks", href: "/admin/form" },
  { key: "niyams", label: "Add niyams", href: "/admin/niyams" },
  { key: "share", label: "Share your join code", href: "/admin/sangh#code" },
];

export function AdminHome() {
  const { sangh } = useAdmin();
  const d = useLoad<Dashboard>(`/api/admin/dashboard?s=${sangh.id}`);

  if (d.state === "loading") return <div className="page"><Loading rows={4} /></div>;
  if (d.state === "error") return <div className="page"><LoadError message={d.message} retry={d.retry} /></div>;
  const x = d.data;
  const todo = STEPS.filter((s) => !x.checklist[s.key]);
  const lamps = Math.min(x.profiles, 30);
  const litLamps = x.profiles ? Math.round((x.loggedToday / x.profiles) * lamps) : 0;

  return (
    <main className="page">
      <section className="today" aria-labelledby="today-h">
        <h1 id="today-h" className="sr-only">Today at {x.sangh.name}</h1>
        <div className="big">
          <b>{x.loggedToday}</b>
          <span>of {x.profiles} {x.profiles === 1 ? "person" : "people"} logged their niyams today</span>
        </div>
        {x.profiles > 0 ? (
          <>
            <div className="meter" role="img" aria-label={`${x.loggingPct}% logged today`}><i style={{ width: `${x.loggingPct}%` }} /></div>
            {lamps > 0 && (
              <div className="lamps" aria-hidden="true" style={{ flexWrap: "wrap" }}>
                {Array.from({ length: lamps }, (_, i) => (
                  <span key={i} className={`lamp${i < litLamps ? " lit" : ""}`}>
                    <svg viewBox="0 0 24 24"><path className="flame" d="M12 3c2.2 2.6 3 4.4 3 6.2A3 3 0 0 1 12 12a3 3 0 0 1-3-2.8C9 7.4 9.8 5.6 12 3z" /><path className="base" d="M3 14h18c-.6 3.6-4.4 6-9 6s-8.4-2.4-9-6z" /></svg>
                  </span>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="hint">Nobody has joined yet. Share your join code to get started.</p>
        )}
        <div className="stats">
          <div className="stat"><b>{x.loggingPct}%</b><span>logged today</span></div>
          <div className="stat"><b>{x.niyamsDoneToday}</b><span>niyams kept today</span></div>
          <div className="stat"><b>{x.families}</b><span>{x.families === 1 ? "family" : "families"}</span></div>
        </div>
      </section>

      {todo.length > 0 && (
        <section className="section" aria-labelledby="setup-h">
          <h2 id="setup-h">Set up your pathshala <small>{STEPS.length - todo.length} of {STEPS.length} done</small></h2>
          <div className="checklist">
            {STEPS.map((s) => {
              const done = x.checklist[s.key];
              return (
                <Link key={s.key} href={s.href} className={`step${done ? " done" : ""}`}>
                  <span className="tick" aria-hidden="true">{done && <Icon.check />}</span>
                  <span className="t">{s.label}</span>
                  <span className="sr-only">{done ? "(done)" : "(to do)"}</span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <section className="section" aria-labelledby="quick-h">
        <h2 id="quick-h">Quick actions</h2>
        <div className="quick">
          <Link href="/admin/sangh#code"><Icon.qr />Share join code</Link>
          <Link href="/admin/niyams?new=1"><Icon.plus />Add a niyam</Link>
          <Link href="/admin/members"><Icon.people />View members</Link>
        </div>
      </section>

      {x.activeNiyams === 0 && x.checklist.niyams && (
        <div className="notice"><b>No niyams are running</b><span>All your niyams are paused or archived, so members have nothing to log today.</span></div>
      )}
    </main>
  );
}
