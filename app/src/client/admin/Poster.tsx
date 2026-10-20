"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "../api";
import { Button } from "../ui";
import { useAdmin } from "./AdminApp";
import { LoadError, Loading, useLoad } from "./kit";
import { joinLink, useQrSvg } from "./SanghPage";
import type { SanghProfile } from "@/lib/admin-types";

/** A printable A4 poster: logo, name, QR code and join code, with MyNiyam's mark. */
export function Poster() {
  const { sangh } = useAdmin();
  const p = useLoad<SanghProfile>(`/api/admin/sangh?s=${sangh.id}`);
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const svg = useQrSvg(p.state === "ready" ? joinLink(p.data.joinCode) : null);

  // On a phone, shrink the 210 mm page to fit the screen; printing always uses the real size.
  useEffect(() => {
    const fit = () => { if (wrap.current) setScale(Math.min(1, wrap.current.clientWidth / 794)); };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [p.state]);

  if (p.state === "loading") return <div className="page"><Loading rows={4} /></div>;
  if (p.state === "error") return <div className="page"><LoadError message={p.message} retry={p.retry} /></div>;
  const s = p.data;
  const host = window.location.host;

  return (
    <main>
      <div className="no-print stack" style={{ paddingTop: "var(--s-4)" }}>
        <div className="btn-row">
          <Link className="btn btn-secondary btn-sm" href="/admin/sangh">Back</Link>
          <Button onClick={() => { void api("/api/admin/sangh/shared", { body: {} }); window.print(); }}>Print or save as PDF</Button>
        </div>
        <p className="hint">Prints on one A4 page. In the print window, pick &ldquo;Save as PDF&rdquo; to send it on WhatsApp.</p>
      </div>
      <div className="poster-wrap" ref={wrap}>
        <div className="poster-fit" style={{ width: 794 * scale, height: 1123 * scale }}>
        <div className="poster-scale" style={{ transform: `scale(${scale})`, width: 794 }}>
          <div className="poster">
            <div style={{ display: "grid", justifyItems: "center" }}>
              <div className="p-logo">{s.logoUrl ? <img src={s.logoUrl} alt="" /> : s.name.replace(/^(shree|shri|sri)\s+/i, "").charAt(0).toUpperCase()}</div>
              <h1>{s.name}</h1>
              {s.nameHi && <p className="p-hi" lang="hi">{s.nameHi}</p>}
              <p className="p-hi">Keep your daily niyams with us on MyNiyam</p>
            </div>
            <div className="p-qr">{svg && <span dangerouslySetInnerHTML={{ __html: svg }} />}</div>
            <div style={{ display: "grid", gap: "4mm", justifyItems: "center" }}>
              <p className="p-steps">Scan with your phone camera, or open <b>{host}/join</b> and enter</p>
              <p className="p-code">{s.joinCode}</p>
              <p className="p-steps" lang="hi">फ़ोन के कैमरे से स्कैन करें, या कोड डालें</p>
            </div>
            <div className="p-brand"><img src="/brand/wordmark.png" alt="MyNiyam" width={880} height={188} /></div>
          </div>
        </div>
        </div>
      </div>
    </main>
  );
}
