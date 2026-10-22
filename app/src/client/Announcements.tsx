"use client";
import { useEffect, useState } from "react";
import { api } from "./api";
import type { AnnouncementCard } from "@/lib/today-types";

/**
 * The pathshala's slides on Today: a slim card that swipes, at most 3. A slide this person saw on an
 * earlier day shrinks to one line (tap to open), so it doesn't push the niyams down every day.
 */
export function Announcements({ items }: { items: AnnouncementCard[] }) {
  // Seen on an earlier day: start small. Otherwise show in full, and tell the server they were seen.
  const [open, setOpen] = useState<Set<string>>(() => new Set(items.filter((a) => !a.seen).map((a) => a.id)));
  const [at, setAt] = useState(0);
  const unseen = items.filter((a) => !a.seen).map((a) => a.id).join(",");
  useEffect(() => {
    if (unseen) void api("/api/announcements/seen", { body: { ids: unseen.split(",") } });
  }, [unseen]);

  if (!items.length) return null;
  return (
    <section className="ann" aria-roledescription="carousel" aria-label="Announcements from your pathshala">
      <div className="ann-track" onScroll={(e) => {
        const el = e.currentTarget;
        setAt(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
      }}>
        {items.map((a, i) => {
          const full = open.has(a.id);
          return (
            <article key={a.id} className={`ann-slide${full ? "" : " small"}`} aria-roledescription="slide" aria-label={`${i + 1} of ${items.length}`}>
              {full ? (
                <>
                  {a.imageUrl && <img className="ann-img" src={a.imageUrl} alt="" loading="lazy" />}
                  <div className="ann-text">
                    <p className="ann-title">{a.pinned && <span className="pill kesar">Pinned</span>} {a.title}</p>
                    {a.body && <p className="ann-body">{a.body}</p>}
                    {a.buttonUrl && <a className="btn btn-secondary ann-btn" href={a.buttonUrl} target="_blank" rel="noopener noreferrer">{a.buttonLabel}</a>}
                  </div>
                </>
              ) : (
                <button type="button" className="ann-line" aria-expanded="false" onClick={() => setOpen((s) => new Set(s).add(a.id))}>
                  <span className="ann-dot" aria-hidden="true" />
                  <span className="grow">{a.title}</span>
                  <span aria-hidden="true">›</span>
                </button>
              )}
            </article>
          );
        })}
      </div>
      {items.length > 1 && (
        <div className="ann-dots" aria-hidden="true">{items.map((a, i) => <i key={a.id} className={i === at ? "on" : undefined} />)}</div>
      )}
    </section>
  );
}
