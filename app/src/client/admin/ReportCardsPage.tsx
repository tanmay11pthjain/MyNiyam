"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "../ui";
import { useAdmin } from "./AdminApp";
import { Icon } from "./icons";
import { LoadError, Loading, useLoad } from "./kit";
import type { ReportCards } from "@/lib/admin-types";

const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
const shiftMonth = (m: string, n: number) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7); };

/** One card per person in a class for a month. Print, or save as PDF from the print screen. */
export function ReportCardsPage() {
  const { sangh, can } = useAdmin();
  const q = useSearchParams();
  const router = useRouter();
  const cls = q.get("class") ?? "";
  const month = q.get("month") ?? new Date().toISOString().slice(0, 7);
  const d = useLoad<ReportCards>(can("view_members") && cls ? `/api/admin/reports/cards?s=${sangh.id}&class=${cls}&month=${month}` : null);

  if (!can("view_members")) return <main className="page"><div className="banner err">You can&apos;t see reports in this pathshala.</div></main>;
  if (d.state === "loading") return <div className="page"><Loading rows={3} /></div>;
  if (d.state === "error") return <div className="page"><LoadError message={d.message} retry={d.retry} /></div>;
  const r = d.data;
  const href = (m: string) => `/admin/reports/cards?class=${cls}&month=${m}`;
  const thisMonth = new Date().toISOString().slice(0, 7);

  return (
    <main className="page">
      <div className="no-print stack">
        <div className="page-title"><h1 data-hi="रिपोर्ट कार्ड">Report cards</h1><p>{r.className}. Print them, or choose &quot;Save as PDF&quot; to send on WhatsApp.</p></div>
        <div className="monthbar">
          <button type="button" aria-label="Previous month" onClick={() => router.replace(href(shiftMonth(month, -1)))}>‹</button>
          <h2>{monthName(month)}</h2>
          <button type="button" aria-label="Next month" disabled={month >= thisMonth} onClick={() => router.replace(href(shiftMonth(month, 1)))}>›</button>
        </div>
        {r.cards.length > 0 && <Button onClick={() => window.print()}><Icon.print />Print or save as PDF</Button>}
      </div>
      {r.cards.length === 0 && <div className="notice"><b>No one in {r.className}</b><span>Cards appear once members join this class.</span></div>}
      <div className="cards">
        {r.cards.map((c, i) => (
          <article key={i} className="rcard">
            <header><span className="brand">MyNiyam</span><span>{r.sangh}</span></header>
            <h3>{c.name}</h3>
            <p className="sub">{r.className} · {monthName(month)}</p>
            <dl>
              <div><dt>Days with niyams</dt><dd>{c.daysLogged} <small>of {r.daysInMonth}</small></dd></div>
              <div><dt>Niyams kept</dt><dd>{c.kept}</dd></div>
              <div><dt>Best streak</dt><dd>{c.bestStreak} <small>{c.bestStreak === 1 ? "day" : "days"}</small></dd></div>
              <div><dt>Pathshala</dt><dd>{c.attendance ? <>{c.attendance.came} <small>of {c.attendance.total}</small></> : "–"}</dd></div>
            </dl>
            <footer>{c.daysLogged >= r.daysInMonth * 0.8 ? "Anumodana! A wonderful month." : c.daysLogged >= r.daysInMonth * 0.5 ? "Well done. Keep going!" : "Every day is a fresh start."}</footer>
          </article>
        ))}
      </div>
    </main>
  );
}
