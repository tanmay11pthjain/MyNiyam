"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { AnnouncementCard } from "@/lib/today-types";

/** The pathshala's announcements on the Sangh tab: wide (16:9) picture slides that swipe, and move on by themselves. */
export function Announcements({ items }: { items: AnnouncementCard[] }) {
  const [at, setAt] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  const held = useRef(false); // a finger on the slides stops the auto-advance
  const unseen = items.filter((a) => !a.seen).map((a) => a.id).join(",");
  useEffect(() => {
    if (unseen) void api("/api/announcements/seen", { body: { ids: unseen.split(",") } });
  }, [unseen]);

  const go = (i: number) => { const el = track.current; if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" }); };
  useEffect(() => {
    if (items.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setInterval(() => { if (!held.current) go((at + 1) % items.length); }, 6000);
    return () => window.clearInterval(t);
  }, [at, items.length]);

  if (!items.length) return null;
  return (
    <section className="ann" aria-roledescription="carousel" aria-label="Announcements from your pathshala">
      <div ref={track} className="ann-track"
        onTouchStart={() => { held.current = true; }} onTouchEnd={() => { held.current = false; }}
        onScroll={(e) => { const el = e.currentTarget; setAt(Math.round(el.scrollLeft / Math.max(1, el.clientWidth))); }}>
        {items.map((a, i) => (
          <article key={a.id} className="ann-slide" aria-roledescription="slide" aria-label={`${i + 1} of ${items.length}`}>
            {a.imageUrl ? <img className="ann-img" src={a.imageUrl} alt="" loading={i ? "lazy" : undefined} /> : <div className="ann-img blank" aria-hidden="true">{a.title}</div>}
            <div className="ann-text">
              <p className="ann-title">{a.pinned && <span className="pill kesar">Pinned</span>} {a.title}</p>
              {a.body && <p className="ann-body">{a.body}</p>}
              {a.buttonUrl && <a className="btn btn-secondary ann-btn" href={a.buttonUrl} target="_blank" rel="noopener noreferrer">{a.buttonLabel}</a>}
            </div>
          </article>
        ))}
      </div>
      {items.length > 1 && (
        <div className="ann-dots">
          {items.map((a, i) => <button key={a.id} type="button" aria-label={`Slide ${i + 1}`} aria-current={i === at || undefined} onClick={() => go(i)}><i className={i === at ? "on" : undefined} /></button>)}
        </div>
      )}
    </section>
  );
}
