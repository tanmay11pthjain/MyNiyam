"use client";
import { useState } from "react";
import Link from "next/link";
import { Button } from "../ui";
import { useAdmin } from "./AdminApp";
import { Icon } from "./icons";
import { LoadError, Loading, useLoad, useToast } from "./kit";
import { DateRangePicker, shortDay, type Range } from "./DateRange";
import type { AdminBoard } from "@/lib/admin-types";


/** The class board by Tej over any dates, and a poster of the top 3 to share on WhatsApp. */
export function LeaderboardPage() {
  const { sangh, can } = useAdmin();
  const toast = useToast();
  const [cls, setCls] = useState<string | null>(null);
  const [range, setRange] = useState<Range | null>(null); // null: this week
  const [today, setToday] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const q = new URLSearchParams({ s: sangh.id, ...(cls ? { class: cls } : {}), ...(range ? { from: range.from, to: range.to } : {}) });
  const d = useLoad<AdminBoard>(can("view_members") ? `/api/admin/leaderboard?${q}` : null);
  const b = d.state === "ready" ? d.data : null;
  if (b && !today) setToday(b.today); // the server's date (India time) for the date picker

  if (!can("view_members")) return <main className="page"><div className="banner err">You can&apos;t see the leaderboard in this pathshala.</div></main>;
  const label = range?.label ?? "This week";
  const c = b?.classes.find((x) => x.id === b.classId);
  const top = b ? b.rows.filter((r) => r.points > 0).slice(0, 3) : [];

  return (
    <main className="page">
      <div className="page-title"><h1 data-hi="लीडरबोर्ड">Leaderboard</h1><p>Who earned the most Tej points. Days kept break a tie.</p></div>
      {today && <DateRangePicker today={today} initial="week" onChange={(r) => { if (r) setRange(r); }} />}
      {d.state === "loading" && <Loading rows={5} />}
      {d.state === "error" && <LoadError message={d.message} retry={d.retry} />}
      {b && (!b.classId ? (
        <div className="notice"><b>No classes yet</b><span>The board is made class by class. Add classes in Setup first.</span></div>
      ) : (
        <>
          {b.classes.length > 1 && (
            <div className="chips" aria-label="Class">
              {b.classes.map((x) => <button key={x.id} type="button" className="chip" aria-pressed={x.id === b.classId} onClick={() => setCls(x.id)}>{x.name}</button>)}
            </div>
          )}
          <p className="hint">{shortDay(b.from)} to {shortDay(b.to)}{c && !c.on ? `. Members of ${c.name} don't see their weekly board (it is off in Setup > Classes).` : ""}</p>

          <Button busy={busy} disabled={top.length === 0} onClick={async () => {
            setBusy(true);
            const r = await sharePoster(b, c?.name ?? "", label, top).catch(() => "failed" as const);
            setBusy(false);
            if (r === "downloaded") toast("Poster saved to your downloads");
            if (r === "failed") toast("The poster couldn't be made. Try again.");
          }}><Icon.share />{busy ? "Making poster…" : "Generate poster"}</Button>
          {top.length === 0 && <p className="hint">The poster is ready once someone in {c?.name} earns Tej in these dates.</p>}

          {b.rows.length === 0 ? (
            <div className="notice"><b>No one in {c?.name} yet</b><span>Members appear here once they join this class.</span></div>
          ) : (
            <ol className="list rank">
              {b.rows.map((r) => (
                <li key={r.id} className="row" style={{ cursor: "default" }}>
                  <b className="pct" style={{ minWidth: 28 }}>{r.rank}</b>
                  <span className="avatar" aria-hidden="true">{r.photoUrl ? <img src={r.photoUrl} alt="" /> : r.name.charAt(0)}</span>
                  <span className="grow"><span className="t">{r.name}</span><span className="s">{r.days} {r.days === 1 ? "day" : "days"} kept</span></span>
                  <b className="pct">{r.points.toLocaleString("en-IN")} Tej</b>
                </li>
              ))}
            </ol>
          )}
          <p className="hint">Names show as members chose: someone who picked &ldquo;only my initials&rdquo; shows as initials, without a photo. <Link href="/admin/classes">Turn the weekly board on or off per class</Link>.</p>
        </>
      ))}
    </main>
  );
}

// ---------------------------------------------------------------------------------------------
// The poster: 1080 × 1350 (fits WhatsApp and Instagram), drawn on the phone. Nothing is uploaded.
// ---------------------------------------------------------------------------------------------
const W = 1080, H = 1350;

function font(v: string, fallback: string) {
  const f = getComputedStyle(document.body).getPropertyValue(v).trim();
  return f || fallback;
}

function loadImg(src: string): Promise<HTMLImageElement | null> {
  return new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
}

async function sharePoster(b: AdminBoard, className: string, label: string, top: AdminBoard["rows"]): Promise<"shared" | "downloaded" | "cancelled"> {
  const display = font("--font-baloo", "'Baloo 2', system-ui, sans-serif"), body = font("--font-mukta", "Mukta, system-ui, sans-serif");
  await document.fonts?.ready;
  const photos = await Promise.all(top.map((r) => (r.photoUrl ? loadImg(r.photoUrl) : Promise.resolve(null))));
  const mark = await loadImg("/brand/wordmark.png");

  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d")!;
  g.fillStyle = "#FAF1E6"; g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W / 2, 640, 60, W / 2, 640, 620);
  glow.addColorStop(0, "rgba(240,157,39,.30)"); glow.addColorStop(1, "rgba(240,157,39,0)");
  g.fillStyle = glow; g.fillRect(0, 0, W, H);

  g.textAlign = "center";
  g.fillStyle = "#B5620A"; g.font = `700 46px ${display}`;
  g.fillText(b.sangh, W / 2, 120, W - 120);
  g.fillStyle = "#1C2F5E"; g.font = `800 92px ${display}`;
  const title = ["This week", "Last week", "This month", "Last month"].includes(label) ? `${label}'s top ${top.length}` : `Top ${top.length}`;
  g.fillText(title, W / 2, 230, W - 100);
  g.fillStyle = "#56607F"; g.font = `500 40px ${body}`;
  g.fillText(`${className} · ${shortDay(b.from)} to ${shortDay(b.to)}`, W / 2, 295, W - 120);

  // 1st in the middle and biggest, 2nd on the left, 3rd on the right.
  const spots = [{ x: W / 2, y: 560, r: 170 }, { x: 220, y: 760, r: 125 }, { x: W - 220, y: 760, r: 125 }];
  const ring = ["#F09D27", "#9AA4B5", "#C07A43"];
  top.forEach((p, i) => {
    const s = spots[i];
    g.save();
    g.beginPath(); g.arc(s.x, s.y, s.r, 0, Math.PI * 2); g.closePath();
    g.fillStyle = "#fff"; g.fill(); g.clip();
    const img = photos[i];
    if (img) {
      const k = Math.max((s.r * 2) / img.width, (s.r * 2) / img.height);
      g.drawImage(img, s.x - (img.width * k) / 2, s.y - (img.height * k) / 2, img.width * k, img.height * k);
    } else {
      g.fillStyle = "#FBE3C0"; g.fillRect(s.x - s.r, s.y - s.r, s.r * 2, s.r * 2);
      g.fillStyle = "#B5620A"; g.font = `800 ${Math.round(s.r * 0.9)}px ${display}`; g.textBaseline = "middle";
      g.fillText(p.name.charAt(0).toUpperCase(), s.x, s.y + s.r * 0.06); g.textBaseline = "alphabetic";
    }
    g.restore();
    g.lineWidth = 14; g.strokeStyle = ring[i];
    g.beginPath(); g.arc(s.x, s.y, s.r, 0, Math.PI * 2); g.stroke();
    // rank medal
    g.fillStyle = ring[i]; g.beginPath(); g.arc(s.x, s.y + s.r, 40, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#fff"; g.font = `800 46px ${display}`; g.fillText(String(p.rank), s.x, s.y + s.r + 16); // a tie shares its number
    g.fillStyle = "#1C2F5E"; g.font = `800 ${i ? 46 : 58}px ${display}`;
    g.fillText(p.name, s.x, s.y + s.r + (i ? 100 : 112), i ? 380 : 600);
    g.fillStyle = "#56607F"; g.font = `500 ${i ? 34 : 40}px ${body}`;
    g.fillText(`${p.points.toLocaleString("en-IN")} Tej`, s.x, s.y + s.r + (i ? 148 : 166));
  });

  g.fillStyle = "#1C2F5E"; g.font = `600 40px ${body}`;
  g.fillText("Anumodana! Keep your niyams every day.", W / 2, 1150, W - 120);
  if (mark) { const mh = 64, mw = (mark.width / mark.height) * mh; g.drawImage(mark, (W - mw) / 2, 1215, mw, mh); }

  const blob = await new Promise<Blob | null>((ok) => cv.toBlob(ok, "image/png"));
  if (!blob) return "cancelled";
  const name = `top-3-${className.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "class"}.png`;
  const file = new File([blob], name, { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return "shared"; } catch { return "cancelled"; }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return "downloaded";
}
