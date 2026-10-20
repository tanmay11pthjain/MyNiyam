"use client";
import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { api, say } from "../api";
import { Button, CityLine, Chevron, Msg, SanghLogo, Title } from "../ui";
import { JOIN_CODE_LENGTH, normalizeJoinCode } from "@/lib/join-code";
import type { SanghCard } from "@/lib/api-types";

const QrScanner = lazy(() => import("../QrScanner"));

type Words = { en: string; hi: string };

/** Step 1: find the pathshala by code, QR or name search. */
export function FindStep({ initialCode, onFound }: { initialCode?: string; onFound: (s: SanghCard) => void }) {
  const [mode, setMode] = useState<"code" | "scan" | "search">("code");
  const [code, setCode] = useState(initialCode ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Words | null>(null);
  const tried = useRef<string | null>(null);

  async function lookup(raw: string) {
    const clean = normalizeJoinCode(raw);
    if (!clean) { setErr(say({ error: "invalid_code" })); return; }
    setBusy(true); setErr(null);
    const r = await api<{ sangh: SanghCard }>(`/api/sanghs/by-code/${clean}`);
    setBusy(false);
    if (r.ok) onFound(r.data.sangh);
    else setErr(say(r.err));
  }

  // A code from the link (/j/HEER01 or ?code=) is looked up straight away.
  useEffect(() => {
    if (initialCode && tried.current !== initialCode) { tried.current = initialCode; void lookup(initialCode); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode]);

  if (mode === "scan") {
    return (
      <div className="screen">
        <Title en="Scan the QR code" hi="QR कोड स्कैन करें" lead="Point your camera at the code on your pathshala's poster." />
        <div className="mt-5">
          <Suspense fallback={<div className="skel" style={{ aspectRatio: 1 }} />}>
            <QrScanner onCode={(c) => { setMode("code"); setCode(c); void lookup(c); }} />
          </Suspense>
        </div>
        <div className="push"><Button kind="secondary" onClick={() => setMode("code")}>Type the code instead</Button></div>
      </div>
    );
  }

  if (mode === "search") return <SearchPanel onPick={onFound} onBack={() => setMode("code")} />;

  return (
    <div className="screen">
      <Title en="Join your pathshala" hi="अपनी पाठशाला से जुड़ें" lead="Type the code your pathshala gave you." />
      <form className="stack mt-6" noValidate onSubmit={(e) => { e.preventDefault(); void lookup(code); }}>
        <label className="label" htmlFor="code">Pathshala code <span className="hi" lang="hi">पाठशाला कोड</span></label>
        <input
          id="code" className="input code-input" value={code} placeholder="HEER01"
          inputMode="text" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={JOIN_CODE_LENGTH}
          aria-invalid={err ? true : undefined} aria-describedby="code-msg"
          onChange={(e) => {
            const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, JOIN_CODE_LENGTH);
            setCode(v); setErr(null);
            if (v.length === JOIN_CODE_LENGTH && !busy) void lookup(v);
          }}
        />
        <Msg id="code-msg" text={err} />
        <Button type="submit" busy={busy} disabled={code.length !== JOIN_CODE_LENGTH}>{busy ? "Finding…" : "Find my pathshala"}</Button>
      </form>

      <div className="divider">or</div>
      <div className="stack">
        <Button kind="secondary" onClick={() => setMode("scan")}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" /><path d="M8 12h8" /></svg>
          Scan QR code
        </Button>
        <Button kind="quiet" onClick={() => setMode("search")}>No code? Search by name</Button>
      </div>
      <p className="hint center push">Already joined? <a href="/login">Log in</a></p>
    </div>
  );
}

function SearchPanel({ onPick, onBack }: { onPick: (s: SanghCard) => void; onBack: () => void }) {
  const [q, setQ] = useState("");
  const [city, setCity] = useState<string | null>(null);
  const [cities, setCities] = useState<string[]>([]);
  const [state, setState] = useState<{ kind: "loading" } | { kind: "done"; sanghs: SanghCard[] } | { kind: "error"; words: Words }>({ kind: "loading" });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      setState({ kind: "loading" });
      const params = new URLSearchParams({ q: q.trim() });
      if (city) params.set("city", city);
      const r = await api<{ sanghs: SanghCard[]; cities: string[] }>(`/api/sanghs/search?${params}`);
      if (!live) return;
      if (r.ok) { setState({ kind: "done", sanghs: r.data.sanghs }); setCities(r.data.cities); }
      else setState({ kind: "error", words: say(r.err) });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q, city, retry]);

  return (
    <div className="screen">
      <Title en="Find your pathshala" hi="अपनी पाठशाला खोजें" />
      <div className="stack mt-5">
        <label className="label" htmlFor="q">Pathshala name <span className="hi" lang="hi">पाठशाला का नाम</span></label>
        <input id="q" className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Heer" autoComplete="off" />
        {cities.length > 1 && (
          <div className="chips" role="group" aria-label="City">
            <button type="button" className="chip" aria-pressed={city === null} onClick={() => setCity(null)}>All cities</button>
            {cities.map((c) => (
              <button key={c} type="button" className="chip" aria-pressed={city === c} onClick={() => setCity(c)}>{c}</button>
            ))}
          </div>
        )}
      </div>
      <div className="stack mt-5" aria-live="polite">
        {state.kind === "loading" && <><div className="skel" /><div className="skel" /></>}
        {state.kind === "error" && (
          <div className="banner err"><span>{state.words.en}</span><Button kind="secondary" onClick={() => setRetry((n) => n + 1)}>Try again</Button></div>
        )}
        {state.kind === "done" && state.sanghs.length === 0 && (
          <div className="notice"><b>No pathshala found</b><span>Try a shorter name, pick &ldquo;All cities&rdquo;, or ask your teacher for the code.</span></div>
        )}
        {state.kind === "done" && state.sanghs.map((s) => (
          <button key={s.id} type="button" className="choice" onClick={() => onPick(s)}>
            <SanghLogo name={s.name} url={s.logoUrl} />
            <span className="grow"><span className="t">{s.name}</span><span className="s"><CityLine city={s.city} /></span></span>
            <Chevron />
          </button>
        ))}
      </div>
      <div className="push"><Button kind="secondary" onClick={onBack}>I have a code</Button></div>
    </div>
  );
}
