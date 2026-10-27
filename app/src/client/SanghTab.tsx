"use client";
import { useCallback, useEffect, useState } from "react";
import { api, say } from "./api";
import { Announcements } from "./Announcements";
import { shareCard } from "./share";
import { Button } from "./ui";
import { ANUMODANA_MSGS } from "@/lib/badges";
import type { FeedPost, GoalCard, SanghTabResponse } from "@/lib/today-types";

type Words = { en: string; hi: string };

const shortDay = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const num = (n: number) => n.toLocaleString("en-IN");

function ago(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (min < 60) return min <= 1 ? "just now" : `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ${h === 1 ? "hour" : "hours"} ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** The Sangh tab: what the pathshala is doing together. Goals, the class's week (if on), and milestones to rejoice in. */
export function SanghTab({ sangh }: { sangh: { name: string; code: string } }) {
  const [data, setData] = useState<SanghTabResponse | null>(null);
  const [err, setErr] = useState<Words | null>(null);

  const load = useCallback(async () => {
    const r = await api<SanghTabResponse>("/api/sangh");
    if (r.ok) { setData(r.data); setErr(null); } else setErr(say(r.err));
  }, []);
  useEffect(() => {
    let live = true;
    void api<SanghTabResponse>("/api/sangh").then((r) => { if (!live) return; if (r.ok) setData(r.data); else setErr(say(r.err)); });
    return () => { live = false; };
  }, []);

  if (err && !data) return <div className="banner err"><span>{err.en}</span><Button kind="secondary" onClick={() => void load()}>Try again</Button></div>;
  if (!data) return <div className="stack" aria-busy="true"><div className="skel" /><div className="skel" /></div>;

  return (
    <div className="stack-lg">
      <Announcements items={data.announcements} />

      {data.goals.length > 0 && (
        <section className="stack" aria-labelledby="goals-h">
          <h2 id="goals-h" className="sec-h">Together <span className="hi" lang="hi">साथ मिलकर</span></h2>
          {data.goals.map((g) => <Goal key={g.id} g={g} sangh={sangh} />)}
        </section>
      )}

      {data.board && (
        <section className="card stack" aria-labelledby="board-h">
          <h2 id="board-h" className="sec-h">{data.board.className} this week</h2>
          <p className="hint">Days with at least one niyam kept, since Monday. It starts again every Monday.</p>
          {data.board.rows.length === 0 ? <p className="hint">Nobody has logged this week yet. Be the first!</p> : (
            <ol className="board">
              {data.board.rows.map((r, i) => (
                <li key={i} className={r.me ? "me" : undefined}>
                  <span className="b-rank">{r.rank}</span><span className="grow">{r.name}{r.me && " (you)"}</span><b>{r.days}</b><span className="b-unit">{r.days === 1 ? "day" : "days"}</span>
                </li>
              ))}
            </ol>
          )}
          {data.board.me && !data.board.rows.some((r) => r.me) && (
            <p className="hint">You: {data.board.me.days} {data.board.me.days === 1 ? "day" : "days"} this week. Every day you log counts.</p>
          )}
        </section>
      )}

      <section className="stack" aria-labelledby="feed-h">
        <h2 id="feed-h" className="sec-h">Anumodana <span className="hi" lang="hi">अनुमोदना</span></h2>
        {data.feed.length === 0 ? (
          <div className="card"><p className="hint">When someone in your pathshala reaches a milestone, it shows here so you can rejoice with them.</p></div>
        ) : data.feed.map((p) => <Post key={p.id} p={p} />)}
        <p className="hint center caught-up">You are all caught up. Jai Jinendra. <span lang="hi">जय जिनेन्द्र</span></p>
      </section>
    </div>
  );
}

function Goal({ g, sangh }: { g: GoalCard; sangh: { name: string; code: string } }) {
  const total = g.kind === "total";
  const pct = total ? Math.min(100, Math.round((g.total / Math.max(1, g.target ?? 1)) * 100)) : Math.min(100, Math.round(((g.mine ?? 0) / Math.max(1, g.days ?? 1)) * 100));
  const done = pct >= 100;
  return (
    <article className={`card goal${done ? " gold" : ""}`}>
      <div className="goal-top">
        <div className="grow">
          <p className="goal-title">{g.title}</p>
          {g.titleHi && <p className="hi" lang="hi">{g.titleHi}</p>}
          <p className="hint">{g.niyam} · {g.state === "upcoming" ? `starts ${shortDay(g.startDate)}` : g.state === "ended" ? `ended ${shortDay(g.endDate)}` : `until ${shortDay(g.endDate)}`}</p>
        </div>
        <span className={`pill ${total ? "kesar" : "ok"}`}>{total ? "Pathshala goal" : "Challenge"}</span>
      </div>
      <div className="pbar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={g.title}><i style={{ width: `${pct}%` }} /></div>
      {total ? (
        <p><b>{num(g.total)}</b> of {num(g.target ?? 0)} {g.unit} · {pct}%</p>
      ) : (
        <p>{done ? <b>You finished it. Anumodana!</b> : <>You: <b>{g.mine ?? 0}</b> of {g.days} days</>} · {g.finishers} {g.finishers === 1 ? "person has" : "people have"} finished</p>
      )}
      {g.state !== "upcoming" && (
        <button type="button" className="link-btn" onClick={() => void shareCard({
          big: total ? `${pct}%` : `${g.mine ?? 0}/${g.days}`, line: g.title, sub: total ? `${num(g.total)} ${g.unit} together` : "My challenge", sangh: sangh.name, code: sangh.code,
        })}>Share</button>
      )}
    </article>
  );
}

function Post({ p }: { p: FeedPost }) {
  const [mine, setMine] = useState<number | null>(p.myMsg);
  const [count, setCount] = useState(p.count);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function send(msg: number | null) {
    const before = { mine, count };
    setMine(msg); setCount(count + (before.mine === null && msg !== null ? 1 : before.mine !== null && msg === null ? -1 : 0)); setOpen(false);
    setBusy(true);
    const r = await api("/api/anumodana", { body: { badgeId: p.id, msg } });
    setBusy(false);
    if (!r.ok) { setMine(before.mine); setCount(before.count); }
  }

  return (
    <article className="card post">
      <span className="badge-mark" aria-hidden="true">{p.mark}</span>
      <div className="grow stack-s">
        <p><b>{p.mine ? "You" : p.name}</b> {p.mine ? "earned" : "reached"} <b>{p.en}</b></p>
        <p className="hint">{ago(p.at)}{count > 0 && ` · ${count} anumodana`}</p>
        {!p.mine && (
          <div className="post-actions">
            <button type="button" className={`anu-btn${mine !== null ? " on" : ""}`} aria-pressed={mine !== null} disabled={busy}
              onClick={() => (mine === null ? void send(0) : setOpen(!open))}>
              🙏 {mine !== null ? ANUMODANA_MSGS[mine].en : "Anumodana"}
            </button>
            <button type="button" className="link-btn" aria-expanded={open} onClick={() => setOpen(!open)}>More words</button>
          </div>
        )}
        {open && (
          <div className="chips" role="group" aria-label="Send a message">
            {ANUMODANA_MSGS.map((m, i) => (
              <button key={i} type="button" className="chip" aria-pressed={mine === i} onClick={() => void send(i)}>{m.en} <span className="hi" lang="hi">{m.hi}</span></button>
            ))}
            {mine !== null && <button type="button" className="chip" onClick={() => void send(null)}>Take back</button>}
          </div>
        )}
      </div>
    </article>
  );
}
