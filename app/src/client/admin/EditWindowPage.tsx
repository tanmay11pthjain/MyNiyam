"use client";
import { useState } from "react";
import { api } from "../api";
import { useAdmin } from "./AdminApp";
import { LoadError, Loading, sayAdmin, useLoad, useToast } from "./kit";
import type { SanghProfile } from "@/lib/admin-types";

// The same choices the server and the database accept.
export const LOG_WINDOWS = [
  { v: 0, t: "Today only" }, { v: 24, t: "1 day back" }, { v: 48, t: "2 days back" }, { v: 72, t: "3 days back" }, { v: 168, t: "7 days back" },
] as const;
export const ATTENDANCE_WINDOWS = [
  { v: 0, t: "Today only" }, { v: 1, t: "1 day back" }, { v: 3, t: "3 days back" }, { v: 7, t: "7 days back" }, { v: 15, t: "15 days back" }, { v: 30, t: "30 days back" },
] as const;

/** In plain words: how far back members may fill in or undo a niyam. */
export function logWindowWords(hours: number): string {
  if (hours <= 0) return "Members can log today only.";
  const days = Math.round(hours / 24);
  return days === 1 ? "Members can also fill in or change yesterday." : `Members can fill in or change up to ${days} days back.`;
}
function attendanceWords(days: number): string {
  if (days <= 0) return "Attendance can be taken or changed for today only.";
  return days === 1 ? "Attendance can be taken or changed for today and yesterday." : `Attendance can be taken or changed up to ${days} days back.`;
}

/** Setup → Edit windows: how far back niyam logs and attendance can still be changed. */
export function EditWindowPage() {
  const { sangh, can } = useAdmin();
  const toast = useToast();
  const d = useLoad<SanghProfile>(can("admin") ? `/api/admin/sangh?s=${sangh.id}` : null);
  const [busy, setBusy] = useState<string | null>(null);

  if (!can("admin")) return <main className="page"><p className="hint">Only the pathshala&apos;s admin can change the edit windows.</p></main>;
  if (d.state === "loading") return <main className="page"><Loading rows={2} /></main>;
  if (d.state === "error") return <main className="page"><LoadError message={d.message} retry={d.retry} /></main>;
  const p = d.data;

  async function save(key: "logBackHours" | "attendanceBackDays", v: number, words: string) {
    setBusy(`${key}:${v}`);
    const r = await api<SanghProfile>("/api/admin/sangh", { method: "PATCH", body: { [key]: v } });
    setBusy(null);
    if (!r.ok) { toast(sayAdmin(r.err)); return; }
    if (d.state === "ready") d.set(r.data);
    toast(words);
  }

  return (
    <main className="page">
      <div className="page-title"><h1 data-hi="बदलाव की समय सीमा">Edit windows</h1><p>How far back things can still be changed. Older days stay as they are.</p></div>

      <section className="section" aria-labelledby="ew-log">
        <h2 id="ew-log">Niyam logs <span className="hi" lang="hi">नियम</span></h2>
        <p className="hint">{logWindowWords(p.logBackHours)}</p>
        <div className="chips" role="group" aria-labelledby="ew-log">
          {LOG_WINDOWS.map((o) => (
            <button key={o.v} type="button" className="chip" aria-pressed={p.logBackHours === o.v} disabled={busy !== null}
              onClick={() => p.logBackHours !== o.v && void save("logBackHours", o.v, logWindowWords(o.v))}>{o.t}</button>
          ))}
        </div>
      </section>

      <section className="section" aria-labelledby="ew-att">
        <h2 id="ew-att">Attendance <span className="hi" lang="hi">हाज़िरी</span></h2>
        <p className="hint">{attendanceWords(p.attendanceBackDays)} This is for you and your volunteers.</p>
        <div className="chips" role="group" aria-labelledby="ew-att">
          {ATTENDANCE_WINDOWS.map((o) => (
            <button key={o.v} type="button" className="chip" aria-pressed={p.attendanceBackDays === o.v} disabled={busy !== null}
              onClick={() => p.attendanceBackDays !== o.v && void save("attendanceBackDays", o.v, attendanceWords(o.v))}>{o.t}</button>
          ))}
        </div>
      </section>
    </main>
  );
}
