"use client";
import { useEffect, type ReactNode } from "react";

// Small shared pieces of the onboarding screens.

export function Frame({ onBack, backLabel = "Back", lamps, right, children }: {
  onBack?: () => void; backLabel?: string; lamps?: { total: number; lit: number }; right?: ReactNode; children: ReactNode;
}) {
  return (
    <div className="frame">
      <header className="bar">
        {onBack ? (
          <button type="button" className="back" onClick={onBack}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
            {backLabel}
          </button>
        ) : (
          // A plain link: "/" is the static landing page (or /home when signed in), so it needs a full page load.
          // eslint-disable-next-line @next/next/no-html-link-for-pages
          <a href="/" className="logo" aria-label="MyNiyam home">
            <img className="day-only" src="/brand/wordmark.png" alt="MyNiyam" width={880} height={188} />
            <img className="night-only" src="/brand/wordmark-night.png" alt="MyNiyam" width={880} height={188} />
          </a>
        )}
        {lamps && <Lamps {...lamps} />}
        {right}
      </header>
      {children}
    </div>
  );
}

/** "/" is a static page (the landing page, or /home when signed in), so it needs a full page load. */
export function goToLanding() {
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign("/");
}

/** One diya per stage of joining; a stage's lamp lights when it is done. */
export function Lamps({ total, lit }: { total: number; lit: number }) {
  return (
    <div className="lamps" role="img" aria-label={`Step ${Math.min(lit + 1, total)} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`lamp${i < lit ? " lit" : i === lit ? " now" : ""}`}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path className="flame" d="M12 3c2.2 2.6 3 4.4 3 6.2A3 3 0 0 1 12 12a3 3 0 0 1-3-2.8C9 7.4 9.8 5.6 12 3z" />
            <path className="base" d="M3 14h18c-.6 3.6-4.4 6-9 6s-8.4-2.4-9-6z" />
          </svg>
        </span>
      ))}
    </div>
  );
}

/** A heading with its Hindi line under it. Each screen has one, so a new screen starts at the top. */
export function Title({ en, hi, lead }: { en: string; hi: string; lead?: ReactNode }) {
  useEffect(() => { window.scrollTo(0, 0); }, []);
  return (
    <div>
      <h1>{en}</h1>
      <p className="hi" lang="hi">{hi}</p>
      {lead && <p className="lead">{lead}</p>}
    </div>
  );
}

export function Button({ kind = "primary", busy, children, ...rest }: {
  kind?: "primary" | "secondary" | "danger" | "quiet"; busy?: boolean; children: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest} type={rest.type ?? "button"} className={`btn btn-${kind}`} aria-busy={busy || undefined} disabled={rest.disabled || busy}>
      {busy && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

/** A status line under a field. Errors in the danger colour, read out by screen readers. */
export function Msg({ text, tone = "err", id }: { text?: { en: string; hi: string } | null; tone?: "err" | "ok"; id?: string }) {
  return (
    <p className={`msg ${tone}`} id={id} role={tone === "err" ? "alert" : "status"} aria-live="polite">
      {text ? <>{text.en} <span lang="hi">{text.hi}</span></> : null}
    </p>
  );
}

export function SanghLogo({ name, url }: { name: string; url: string | null }) {
  return (
    <div className="sangh-logo" aria-hidden="true">
      {url ? <img src={url} alt="" /> : name.replace(/^(shree|shri|sri)\s+/i, "").charAt(0).toUpperCase()}
    </div>
  );
}

export function CityLine({ city }: { city: string }) {
  return (
    <span className="city">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>
      {city}
    </span>
  );
}

export const Chevron = () => (
  <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
);
