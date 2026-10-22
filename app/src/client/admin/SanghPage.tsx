"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "../api";
import { Button, SanghLogo } from "../ui";
import { useAdmin } from "./AdminApp";
import { Icon } from "./icons";
import { Confirm, LoadError, Loading, Sheet, Switch, sayAdmin, shrinkImage, upload, useLoad, useToast } from "./kit";
import { CITIES, NAVKARSI_AFTER_SUNRISE_MIN, clock, sunTimes } from "@/lib/sun";
import type { SanghProfile } from "@/lib/admin-types";
import { formatPhone } from "@/lib/phone";

export const joinLink = (code: string) => `${window.location.origin}/j/${code}`;

/** The QR code for a join link as SVG markup (the qrcode library loads only when needed). */
export function useQrSvg(text: string | null): string | null {
  const [svg, setSvg] = useState<{ text: string; svg: string } | null>(null);
  useEffect(() => {
    if (!text) return;
    let live = true;
    void import("qrcode").then((QR) => QR.toString(text, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#1C2F5E", light: "#FFFFFF" } }))
      .then((s) => { if (live) setSvg({ text, svg: s }); });
    return () => { live = false; };
  }, [text]);
  return svg && svg.text === text ? svg.svg : null;
}

export function SanghPage() {
  const { sangh, refresh } = useAdmin();
  const p = useLoad<SanghProfile>(`/api/admin/sangh?s=${sangh.id}`);
  if (p.state === "loading") return <div className="page"><Loading rows={5} /></div>;
  if (p.state === "error") return <div className="page"><LoadError message={p.message} retry={p.retry} /></div>;
  return (
    <main className="page">
      <div className="page-title"><h1 data-hi="पाठशाला">Pathshala</h1><p>Your join code, your details and who can join.</p></div>
      <CodeSection profile={p.data} onChange={p.set} />
      <JoinSettings profile={p.data} onChange={p.set} />
      <SunPlace profile={p.data} onChange={p.set} />
      <Details profile={p.data} onSaved={(x) => { p.set(x); refresh(); }} />
      <HandOver name={p.data.name} />
    </main>
  );
}

function CodeSection({ profile, onChange }: { profile: SanghProfile; onChange: (p: SanghProfile) => void }) {
  const toast = useToast();
  const [qrOpen, setQrOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const link = typeof window === "undefined" ? null : joinLink(profile.joinCode);
  const svg = useQrSvg(link);
  const shared = () => void api("/api/admin/sangh/shared", { body: {} });

  const message = `Join ${profile.name} on MyNiyam to keep your daily niyams.\nOpen ${link} or enter the code ${profile.joinCode}.`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(profile.joinCode);
      toast(`Code ${profile.joinCode} copied`);
      shared();
    } catch {
      toast("Couldn't copy. Press and hold the code to copy it.");
    }
  }

  async function downloadPng() {
    if (!link) return;
    const QR = await import("qrcode");
    const url = await QR.toDataURL(link, { width: 1024, margin: 2, errorCorrectionLevel: "M", color: { dark: "#1C2F5E", light: "#FFFFFF" } });
    const a = document.createElement("a");
    a.href = url;
    a.download = `myniyam-${profile.joinCode}.png`;
    a.click();
    shared();
  }

  return (
    <section className="section" id="code" aria-labelledby="code-h">
      <h2 id="code-h">Join code</h2>
      <div className="code-card">
        <span className="code" aria-label={`Join code ${profile.joinCode.split("").join(" ")}`}>{profile.joinCode}</span>
        <button type="button" className="qr" style={{ border: 0, cursor: "zoom-in" }} aria-label="Show the QR code full size" onClick={() => setQrOpen(true)}>
          {svg ? <span dangerouslySetInnerHTML={{ __html: svg }} /> : <span className="skel" style={{ display: "block", height: "100%", minHeight: 0 }} />}
        </button>
        <p className="hint">Members scan this or type the code to join.</p>
        {!profile.joinOpen && <p className="pill warn">Joins are paused: the code won&apos;t let anyone new in</p>}
      </div>
      <div className="btn-row">
        <a className="btn btn-primary" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer" onClick={shared}>
          <Icon.share /> Share on WhatsApp
        </a>
      </div>
      <div className="btn-row">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copy()}><Icon.copy /> Copy code</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void downloadPng()}><Icon.download /> QR as PNG</button>
        <Link className="btn btn-secondary btn-sm" href="/admin/sangh/poster"><Icon.print /> A4 poster</Link>
      </div>
      <Button kind="quiet" onClick={() => setConfirm(true)}><Icon.refresh /> Make a new code</Button>

      {qrOpen && svg && (
        <Sheet title={`Scan to join ${profile.name}`} onClose={() => setQrOpen(false)}>
          <div className="qr" style={{ width: "min(100%, 360px)", height: "auto", aspectRatio: 1, justifySelf: "center" }} dangerouslySetInnerHTML={{ __html: svg }} />
          <p className="center" style={{ font: "700 var(--fs-28) var(--font-mono)", letterSpacing: ".14em" }}>{profile.joinCode}</p>
          <Button kind="secondary" onClick={() => setQrOpen(false)}>Close</Button>
        </Sheet>
      )}
      {confirm && (
        <Confirm
          title="Make a new join code?"
          body={<>
            <p>The code <b>{profile.joinCode}</b>, its QR code and every printed poster <b>stop working straight away</b>.</p>
            <p>People who already joined are not affected. Share the new code with anyone still to join.</p>
          </>}
          action="Make a new code"
          onClose={() => setConfirm(false)}
          onConfirm={async () => {
            const r = await api<{ joinCode: string }>("/api/admin/sangh/code", { body: {} });
            if (!r.ok) return sayAdmin(r.err);
            onChange({ ...profile, joinCode: r.data.joinCode });
            toast(`New code: ${r.data.joinCode}`);
            return null;
          }}
        />
      )}
    </section>
  );
}

function JoinSettings({ profile, onChange }: { profile: SanghProfile; onChange: (p: SanghProfile) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<"joinOpen" | "searchable" | null>(null);
  async function set(key: "joinOpen" | "searchable", value: boolean) {
    setBusy(key);
    const r = await api<SanghProfile>("/api/admin/sangh", { method: "PATCH", body: { [key]: value } });
    setBusy(null);
    if (r.ok) {
      onChange(r.data);
      toast(key === "joinOpen" ? (value ? "New members can join again" : "New joins paused") : value ? "Shown in name search" : "Hidden from name search");
    } else toast(sayAdmin(r.err));
  }
  return (
    <section className="section" aria-labelledby="join-h">
      <h2 id="join-h">Who can join</h2>
      <div className="list">
        <Switch label="Take new members" sub={profile.joinOpen ? "Anyone with the code can join." : "Paused. Existing members are not affected."}
          checked={profile.joinOpen} busy={busy === "joinOpen"} onChange={(v) => void set("joinOpen", v)} />
        <Switch label="Show in name search" sub={profile.searchable ? "People can find you by name." : "Only the code or QR finds you."}
          checked={profile.searchable} busy={busy === "searchable"} onChange={(v) => void set("searchable", v)} />
      </div>
    </section>
  );
}

/** Where sunrise and sunset are worked out for, so Navkarsi and Chauvihar cards show the right time. */
function SunPlace({ profile, onChange }: { profile: SanghProfile; onChange: (p: SanghProfile) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const known = CITIES.find((c) => c.name.toLowerCase() === profile.city.trim().toLowerCase());
  const place = profile.location ?? (known ? { lat: known.lat, lon: known.lon } : null);
  const [today] = useState(() => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }));
  const sun = place ? sunTimes(today, place.lat, place.lon) : null;
  const named = profile.location ? CITIES.find((c) => Math.abs(c.lat - profile.location!.lat) < 1e-3 && Math.abs(c.lon - profile.location!.lon) < 1e-3)?.name : null;

  async function save(location: { lat: number; lon: number } | null, msg: string) {
    setBusy(true);
    const r = await api<SanghProfile>("/api/admin/sangh", { method: "PATCH", body: { location } });
    setBusy(false);
    if (r.ok) { onChange(r.data); setOpen(false); toast(msg); } else toast(sayAdmin(r.err));
  }
  function here() {
    if (!navigator.geolocation) { toast("This phone can't share its location. Pick a city instead."); return; }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (g) => {
        const lat = Math.round(g.coords.latitude * 1e4) / 1e4, lon = Math.round(g.coords.longitude * 1e4) / 1e4;
        if (lat < 6 || lat > 38 || lon < 68 || lon > 98) { setBusy(false); toast("That place is outside India. Pick a city instead."); return; }
        void save({ lat, lon }, "Place saved from this phone");
      },
      () => { setBusy(false); toast("Location wasn't shared. Pick a city instead."); },
      { enableHighAccuracy: false, timeout: 15000 },
    );
  }

  return (
    <section className="section" aria-labelledby="sun-h">
      <h2 id="sun-h">Sunrise and sunset</h2>
      <div className="card stack">
        {place && sun ? (
          <>
            <p>Today at {named ?? (profile.location ? "your pathshala's place" : profile.city)}: sunrise <b>{clock(sun.sunrise)}</b>, sunset <b>{clock(sun.sunset)}</b>.</p>
            <p className="hint">Navkarsi cards show &ldquo;By {clock(sun.sunrise + NAVKARSI_AFTER_SUNRISE_MIN)}&rdquo; and Chauvihar cards &ldquo;Before {clock(sun.sunset)}&rdquo;, worked out fresh each day.</p>
          </>
        ) : (
          <p className="hint">Choose where your pathshala is, so Navkarsi and Chauvihar cards show today&apos;s times.</p>
        )}
        <Button kind="secondary" onClick={() => setOpen(true)}>{place ? "Change place" : "Choose place"}</Button>
      </div>
      {open && (
        <Sheet title="Where is your pathshala?" onClose={() => setOpen(false)}>
          <Button busy={busy} onClick={here}>Use this phone&apos;s location</Button>
          <p className="label">Or pick a city</p>
          <div className="chips">
            {CITIES.map((c) => (
              <button key={c.name} type="button" className="chip" aria-pressed={named === c.name} disabled={busy}
                onClick={() => void save({ lat: c.lat, lon: c.lon }, `Times now for ${c.name}`)}>{c.name}</button>
            ))}
          </div>
          {profile.location && <Button kind="quiet" onClick={() => void save(null, "Place cleared")}>Clear the place</Button>}
        </Sheet>
      )}
    </section>
  );
}

function Details({ profile, onSaved }: { profile: SanghProfile; onSaved: (p: SanghProfile) => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    name: profile.name, nameHi: profile.nameHi ?? "", city: profile.city, area: profile.area ?? "",
    sampraday: profile.sampraday ?? "", contactPhone: profile.contactPhone ? formatPhone(profile.contactPhone).replace("+91 ", "") : "", about: profile.about ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [logo, setLogo] = useState(profile.logoUrl);
  const [logoBusy, setLogoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const up = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setF({ ...f, [k]: e.target.value }); setErr(null); };

  async function save() {
    if (f.name.trim().length < 2 || f.city.trim().length < 2) { setErr("Name and city are needed."); return; }
    setBusy(true); setErr(null);
    const r = await api<SanghProfile>("/api/admin/sangh", { method: "PATCH", body: { ...f, contactPhone: f.contactPhone.trim() || null } });
    setBusy(false);
    if (r.ok) { onSaved(r.data); toast("Details saved"); } else setErr(sayAdmin(r.err));
  }

  async function pickLogo(file: File | undefined) {
    if (!file) return;
    setLogoBusy(true);
    try {
      const r = await upload<{ logoUrl: string }>("/api/admin/sangh/logo", await shrinkImage(file, 512));
      if (r.ok) { setLogo(r.data.logoUrl); toast("Logo updated"); } else toast(sayAdmin(r.err));
    } catch {
      toast("That file isn't a picture we can read. Try a JPG or PNG.");
    }
    setLogoBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <section className="section" aria-labelledby="det-h">
      <h2 id="det-h">Details</h2>
      <div className="card stack-lg">
        <div style={{ display: "flex", alignItems: "center", gap: "var(--s-4)" }}>
          <SanghLogo name={f.name} url={logo} />
          <div className="stack" style={{ flex: 1 }}>
            <input ref={fileRef} id="logo" type="file" accept="image/*" className="sr-only" onChange={(e) => void pickLogo(e.target.files?.[0])} />
            <label htmlFor="logo" className="btn btn-secondary btn-sm" aria-busy={logoBusy || undefined}>{logoBusy && <span className="spinner" aria-hidden="true" />}{logo ? "Change logo" : "Add logo"}</label>
            {logo && <Button kind="quiet" onClick={async () => { const r = await api("/api/admin/sangh/logo", { method: "DELETE", body: {} }); if (r.ok) { setLogo(null); toast("Logo removed"); } }}>Remove logo</Button>}
          </div>
        </div>
        <div className="field"><label className="label" htmlFor="sn">Name</label><input id="sn" className="input" value={f.name} maxLength={120} onChange={up("name")} /></div>
        <div className="field"><label className="label" htmlFor="snh">Name in Hindi <span className="opt">(optional)</span></label><input id="snh" className="input" lang="hi" value={f.nameHi} maxLength={120} onChange={up("nameHi")} /></div>
        <div className="grid-2">
          <div className="field"><label className="label" htmlFor="sc">City</label><input id="sc" className="input" value={f.city} maxLength={80} onChange={up("city")} /></div>
          <div className="field"><label className="label" htmlFor="sa">Area <span className="opt">(optional)</span></label><input id="sa" className="input" value={f.area} maxLength={80} onChange={up("area")} /></div>
        </div>
        <div className="field"><label className="label" htmlFor="ss">Sampraday <span className="opt">(optional)</span></label><input id="ss" className="input" value={f.sampraday} maxLength={80} placeholder="e.g. Murtipujak" onChange={up("sampraday")} /></div>
        <div className="field">
          <label className="label" htmlFor="sp">Contact number <span className="opt">(optional)</span></label>
          <div className="phone-row"><span className="cc" aria-hidden="true">+91</span><input id="sp" type="tel" inputMode="numeric" value={f.contactPhone} maxLength={14} onChange={up("contactPhone")} /></div>
        </div>
        <div className="field"><label className="label" htmlFor="sab">About <span className="opt">(one line, optional)</span></label><textarea id="sab" className="input" value={f.about} maxLength={200} onChange={up("about")} /></div>
        {err && <p className="msg err" role="alert">{err}</p>}
        <Button busy={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save details"}</Button>
      </div>
    </section>
  );
}

/** Hand the pathshala to another number. Codes go to both numbers, and both are needed. */
function HandOver({ name }: { name: string }) {
  const { refresh } = useAdmin();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ phone: "", myCode: "", theirCode: "" });
  const [sent, setSent] = useState<{ simulated: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const up = (x: Partial<typeof f>) => { setF((y) => ({ ...y, ...x })); setErr(null); };

  async function go() {
    if (f.phone.replace(/\D/g, "").length < 10) { setErr("Enter the new admin's 10-digit number."); return; }
    if (sent && (f.myCode.length < 4 || f.theirCode.length < 4)) { setErr("Type both codes."); return; }
    setBusy(true);
    const r = await api<{ simulated: boolean }>("/api/admin/sangh/transfer", { body: sent ? { step: "confirm", ...f } : { step: "send", phone: f.phone } });
    setBusy(false);
    if (!r.ok) { setErr(sayAdmin(r.err)); return; }
    if (!sent) { setSent(r.data); return; }
    // This number no longer runs the pathshala: reload the list of pathshalas it can open.
    refresh();
    router.push("/admin");
  }

  return (
    <section className="section" aria-labelledby="ho-h">
      <h2 id="ho-h">Hand over the pathshala</h2>
      <p className="hint">Give {name} to a new admin, for example when you step down. You stop being its admin. Other admins stay.</p>
      <Button kind="quiet" onClick={() => setOpen(true)}>Hand over to another number</Button>
      {open && (
        <Sheet title="Hand over the pathshala" danger onClose={() => { setOpen(false); setSent(null); }}>
          <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); void go(); }}>
            <div className="field"><label className="label" htmlFor="hp">New admin&apos;s mobile number</label>
              <div className="phone-row"><span className="cc" aria-hidden="true">+91</span>
                <input id="hp" type="tel" inputMode="numeric" maxLength={14} value={f.phone} disabled={!!sent} onChange={(e) => up({ phone: e.target.value })} /></div></div>
            {sent && (
              <>
                <p>We sent a code to your number and one to theirs. Both are needed.</p>
                {sent.simulated && <p className="hint">Test mode: both codes are 1234.</p>}
                <div className="grid-2">
                  <div className="field"><label className="label" htmlFor="c1">Your code</label>
                    <input id="c1" className="input" inputMode="numeric" maxLength={6} value={f.myCode} onChange={(e) => up({ myCode: e.target.value.replace(/\D/g, "") })} /></div>
                  <div className="field"><label className="label" htmlFor="c2">Their code</label>
                    <input id="c2" className="input" inputMode="numeric" maxLength={6} value={f.theirCode} onChange={(e) => up({ theirCode: e.target.value.replace(/\D/g, "") })} /></div>
                </div>
              </>
            )}
            {err && <p className="msg err" role="alert">{err}</p>}
            <Button type="submit" busy={busy}>{busy ? "Please wait…" : sent ? "Hand over now" : "Send codes"}</Button>
          </form>
        </Sheet>
      )}
    </section>
  );
}
