"use client";
import { useState } from "react";
import Link from "next/link";
import { useAdmin } from "./AdminApp";
import { Icon } from "./icons";
import { LoadError, Loading, useLoad } from "./kit";
import type { Report } from "@/lib/admin-types";

const short = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const wk = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "narrow", timeZone: "UTC" });

/** Logging trends, classes, niyams and the most regular members. Admins and volunteers with "view members". */
export function ReportsPage() {
  const { sangh, can } = useAdmin();
  const [days, setDays] = useState<7 | 30>(7);
  const [cls, setCls] = useState<string>("");
  const d = useLoad<Report>(can("view_members") ? `/api/admin/reports?s=${sangh.id}&days=${days}${cls ? `&class=${cls}` : ""}` : null);

  if (!can("view_members")) return <main className="page"><div className="banner err">You can&apos;t see reports in this pathshala.</div></main>;
  const month = new Date().toISOString().slice(0, 7);

  return (
    <main className="page">
      <div className="page-title"><h1 data-hi="रिपोर्ट">Reports</h1><p>How regularly your members log their niyams.</p></div>
      <div className="seg" role="group" aria-label="Period">
        <button type="button" className="chip" aria-pressed={days === 7} onClick={() => setDays(7)}>Last 7 days</button>
        <button type="button" className="chip" aria-pressed={days === 30} onClick={() => setDays(30)}>Last 30 days</button>
      </div>
      {d.state === "ready" && d.data.classes.length > 1 && (
        <div className="chips" aria-label="Class">
          <button type="button" className="chip" aria-pressed={cls === ""} onClick={() => setCls("")}>All classes</button>
          {d.data.classes.map((c) => <button key={c.id} type="button" className="chip" aria-pressed={cls === c.id} onClick={() => setCls(c.id)}>{c.name}</button>)}
        </div>
      )}
      {d.state === "loading" && <Loading rows={4} />}
      {d.state === "error" && <LoadError message={d.message} retry={d.retry} />}
      {d.state === "ready" && <Body r={d.data} month={month} admin={can("admin")} sanghId={sangh.id} />}
    </main>
  );
}

function Body({ r, month, admin, sanghId }: { r: Report; month: string; admin: boolean; sanghId: string }) {
  const avg = r.trend.length ? Math.round(r.trend.reduce((a, t) => a + t.pct, 0) / r.trend.length) : 0;
  const today = r.trend[r.trend.length - 1];
  const cardClass = r.classId ?? r.classes[0]?.id;
  return (
    <>
      <section className="section" aria-labelledby="trend-h">
        <h2 id="trend-h">People who logged each day</h2>
        <div className="stats">
          <div className="stat"><b>{avg}%</b><span>on an average day</span></div>
          <div className="stat"><b>{today?.pct ?? 0}%</b><span>today</span></div>
          <div className="stat"><b>{r.newJoins}</b><span>{r.newJoins === 1 ? "new person" : "new people"}</span></div>
        </div>
        <div className={`bars${r.days === 30 ? " dense" : ""}`} role="img" aria-label={`Share of people who logged, ${short(r.from)} to ${short(r.to)}. Average ${avg}%.`}>
          {r.trend.map((t, i) => (
            <div key={t.day} className="bar" title={`${short(t.day)}: ${t.logged} of ${t.people} logged (${t.pct}%)`}>
              <span className="v">{i === r.trend.length - 1 || r.days === 7 ? `${t.pct}%` : ""}</span>
              <i style={{ height: `${Math.max(t.pct, 2)}%` }} />
              <span className="k">{r.days === 7 ? wk(t.day) : i % 7 === 0 || i === r.trend.length - 1 ? short(t.day) : ""}</span>
            </div>
          ))}
        </div>
      </section>

      {!r.classId && r.byClass.length > 1 && (
        <section className="section" aria-labelledby="cls-h">
          <h2 id="cls-h">By class</h2>
          <p className="hint">Days logged out of days possible, per person.</p>
          <div className="list">
            {r.byClass.map((c) => (
              <div key={c.classId ?? "none"} className="row" style={{ cursor: "default" }}>
                <span className="grow"><span className="t">{c.name}</span><span className="s">{c.people} {c.people === 1 ? "person" : "people"}</span></span>
                <span className="hbar" aria-hidden="true"><i style={{ width: `${c.pct}%` }} /></span>
                <b className="pct">{c.pct}%</b>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="section" aria-labelledby="top-h">
        <h2 id="top-h">Most regular</h2>
        {r.top.length === 0 ? <p className="hint">No one has logged in this period yet.</p> : (
          <ol className="list rank">
            {r.top.map((p) => (
              <li key={p.id} className="row" style={{ cursor: "default" }}>
                <span className="grow"><span className="t">{p.name}</span><span className="s">{[p.class, `${p.kept} niyams kept`].filter(Boolean).join(" · ")}</span></span>
                <b className="pct">{p.days} of {r.days} days</b>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="section" aria-labelledby="ny-h">
        <h2 id="ny-h">Niyams kept</h2>
        {r.niyams.length === 0 ? <p className="hint">Nothing kept in this period yet.</p> : (
          <div className="list">
            {r.niyams.map((n) => (
              <div key={n.id} className="row" style={{ cursor: "default" }}>
                <span className="grow"><span className="t">{n.name}</span><span className="s">by {n.people} {n.people === 1 ? "person" : "people"}</span></span>
                <b className="pct">{n.done}×</b>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="dl-h">
        <h2 id="dl-h">Print and download</h2>
        <div className="quick stacked">
          {cardClass && <Link href={`/admin/reports/cards?class=${cardClass}&month=${month}`}><Icon.print />Report cards for {r.classes.find((c) => c.id === cardClass)?.name}</Link>}
          {admin && <a href={`/api/admin/reports/excel?s=${sanghId}`} download><Icon.download />Download Excel report</a>}
        </div>
        {admin && <p className="hint">It has members, their phone numbers, attendance with gathas, and niyams for the last 30 days. Keep the file safe and delete it when you&apos;re done.</p>}
      </section>
    </>
  );
}
