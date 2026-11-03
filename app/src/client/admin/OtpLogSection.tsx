"use client";
import { useState } from "react";
import { Button } from "../ui";
import { LoadError, Loading, useLoad } from "./kit";
import type { OtpLog, OtpLogRow } from "@/lib/admin-types";
import { formatPhone } from "@/lib/phone";

const WORDS: Record<OtpLogRow["status"], { label: string; tone: "" | "ok" | "warn" | "err" }> = {
  practice: { label: "Practice (1234)", tone: "" },
  sending: { label: "Sending", tone: "warn" },
  queued: { label: "With the phone", tone: "warn" },
  sent: { label: "Sent", tone: "ok" },
  delivered: { label: "Delivered", tone: "ok" },
  failed: { label: "Failed", tone: "err" },
  verified: { label: "Used to log in", tone: "ok" },
};

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

function ago(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

/** Super admin: every login code with its number, to check a code with a member over the phone. */
export function OtpLogSection() {
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const d = useLoad<OtpLog>(`/api/admin/super/otp-log${search ? `?phone=${encodeURIComponent(search)}` : ""}`);

  return (
    <section className="section">
      <h2>Login codes <small>last 30 days</small></h2>
      <form className="btn-row" noValidate onSubmit={(e) => { e.preventDefault(); setSearch(typed.replace(/\D/g, "")); }}>
        <input className="input input-sm" type="tel" inputMode="numeric" placeholder="Search a mobile number" aria-label="Search a mobile number"
          value={typed} onChange={(e) => setTyped(e.target.value.replace(/[^\d ]/g, ""))} style={{ flex: 1 }} />
        <Button kind="secondary" type="submit">Search</Button>
      </form>
      {d.state === "loading" ? <Loading rows={3} /> : d.state === "error" ? <LoadError message={d.message} retry={d.retry} /> : (
        <>
          <Gateway log={d.data} />
          {d.data.rows.length === 0 ? (
            <div className="notice"><b>No codes {search ? "for this number" : "yet"}</b><span>Every code sent to a member shows up here.</span></div>
          ) : (
            <div className="list">
              {d.data.rows.map((r) => (
                <div key={r.id} className="row" style={{ cursor: "default" }}>
                  <span className="grow">
                    <span className="t">{formatPhone(r.phone)} · <span style={{ fontFamily: "monospace", letterSpacing: "0.15em" }}>{r.code}</span></span>
                    <span className="s">
                      {when(r.createdAt)}{r.delivery === "phone" ? " · by our SMS phone" : r.delivery === "msg91" ? ` · MSG91 ${r.channel}` : ""}
                      {r.status === "failed" && r.error ? ` · ${r.error}` : ""}
                    </span>
                  </span>
                  <span className={`pill ${WORDS[r.status].tone}`}>{WORDS[r.status].label}</span>
                </div>
              ))}
            </div>
          )}
          <Button kind="quiet" onClick={d.reload}>Refresh</Button>
        </>
      )}
    </section>
  );
}

function Gateway({ log }: { log: OtpLog }) {
  if (log.delivery === "simulate") return <div className="notice"><b>Practice mode</b><span>No SMS is sent. Every code is 1234.</span></div>;
  if (log.delivery === "msg91") return null;
  if (log.relayOk === false) return <div className="notice"><b>Can&apos;t read the SMS phone&apos;s reports</b><span>The relay (ntfy) didn&apos;t answer. Codes may still be going out. Try Refresh.</span></div>;
  return (
    <div className="notice">
      <b>Codes go out from our SMS phone</b>
      <span>{log.lastPhoneReport ? `The phone last reported ${ago(log.lastPhoneReport)}.` : "The phone hasn't reported anything in the last 24 hours."} If codes stay at &quot;With the phone&quot;, check the phone is on, online and the gateway is ON.</span>
    </div>
  );
}
