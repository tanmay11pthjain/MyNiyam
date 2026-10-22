"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, type Result } from "../api";
import { Button } from "../ui";
import type { ApiError } from "@/lib/api-types";

// Small shared pieces of the admin screens. English only for now (Hindi admin labels are P2).

/** Plain-English words for an admin API error. */
export function sayAdmin(err: ApiError | { error: "offline" }): string {
  switch (err.error) {
    case "offline": return "No internet. Check your connection and try again.";
    case "unauthorized": return "Please log in again.";
    case "forbidden": return "You can't do that with this account.";
    case "no_sangh": return "You are no longer an admin of this pathshala.";
    case "class_has_members": return "This class still has members. Move them to another class first, or hide the class from new joins.";
    case "invalid_phone": return "Enter a 10-digit mobile number.";
    case "invalid_field":
    case "duplicate_key": return "Some fields are not filled in correctly. Check the names and options.";
    case "too_large": return "That picture is too big. Try a smaller one.";
    case "unsupported_type": return "Use a JPG, PNG or WebP picture.";
    case "too_many_requests": return "Too many tries. Please wait a little and try again.";
    case "not_found": return "That isn't here any more. It may have been removed.";
    case "wrong_code": return `That code is not right.${err.attemptsLeft ? ` ${err.attemptsLeft} ${err.attemptsLeft === 1 ? "try" : "tries"} left.` : ""}`;
    case "code_expired":
    case "no_code": return "This code has expired. Send a new one.";
    case "bad_request": return "Something in the form isn't right. Check it and try again.";
    case "already_admin": return "This number is already an admin of this pathshala.";
    case "already_member": return "This number has already joined. Find them in Members.";
    case "same_number": return "That is your own number. Enter the new admin's number.";
    case "invalid_class": return "One of the chosen classes isn't here any more. Pick again.";
    default: return "Something went wrong on our side. Please try again.";
  }
}

export type Load<T> = { state: "loading" } | { state: "error"; message: string; retry: () => void } | { state: "ready"; data: T; reload: () => void; set: (d: T) => void };

/** GETs `path` and keeps the four states: loading, error (with retry), ready (with reload). */
export function useLoad<T>(path: string | null): Load<T> {
  const [res, setRes] = useState<Result<T> | null>(null);
  const [n, setN] = useState(0);
  const reload = useCallback(() => setN((x) => x + 1), []);
  useEffect(() => {
    if (!path) return;
    let live = true;
    void api<T>(path).then((r) => { if (live) setRes(r); });
    return () => { live = false; };
  }, [path, n]);
  if (!res) return { state: "loading" };
  if (!res.ok) {
    if (res.err.error === "unauthorized" && typeof window !== "undefined") window.location.replace("/admin/login");
    return { state: "error", message: sayAdmin(res.err), retry: () => { setRes(null); reload(); } };
  }
  return { state: "ready", data: res.data, reload, set: (d: T) => setRes({ ok: true, data: d }) };
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return <div className="stack" aria-busy="true">{Array.from({ length: rows }, (_, i) => <div key={i} className="skel" />)}</div>;
}

export function LoadError({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="banner err" role="alert">
      <span>{message}</span>
      <div><Button kind="secondary" onClick={retry}>Try again</Button></div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toast: one line at the bottom that says what just happened.
// ---------------------------------------------------------------------------
const ToastCtx = createContext<(text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: ReactNode }) {
  const [text, setText] = useState<string | null>(null);
  const t = useRef<number | undefined>(undefined);
  const show = useCallback((s: string) => {
    setText(s);
    window.clearTimeout(t.current);
    t.current = window.setTimeout(() => setText(null), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div role="status" aria-live="polite">{text && <div className="toast admin-toast">{text}</div>}</div>
    </ToastCtx.Provider>
  );
}

// ---------------------------------------------------------------------------
// Sheet: a bottom sheet on phones, a dialog on desktop. Escape or a tap outside closes it.
// ---------------------------------------------------------------------------
export function Sheet({ title, danger, onClose, children }: { title: string; danger?: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input, select, textarea, button:not([data-close])")?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="sheet-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={`sheet${danger ? " danger" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** "Are you sure?" for destructive actions: danger colour, plain words, the real consequence. */
export function Confirm({ title, body, action, onConfirm, onClose }: {
  title: string; body: ReactNode; action: string; onConfirm: () => Promise<string | null>; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Sheet title={title} danger onClose={onClose}>
      <div className="stack" style={{ fontSize: "var(--fs-16)" }}>{body}</div>
      {err && <p className="msg err" role="alert">{err}</p>}
      <div className="stack">
        <Button kind="danger" busy={busy} onClick={async () => {
          setBusy(true); setErr(null);
          const problem = await onConfirm();
          setBusy(false);
          if (problem) setErr(problem); else onClose();
        }}>{action}</Button>
        <Button kind="secondary" data-close onClick={onClose}>Cancel</Button>
      </div>
    </Sheet>
  );
}

export function Switch({ label, sub, checked, busy, onChange }: { label: string; sub?: string; checked: boolean; busy?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="switch-row">
      <span className="grow"><span className="t">{label}</span>{sub && <span className="s">{sub}</span>}</span>
      {busy && <span className="spinner" aria-hidden="true" />}
      <input type="checkbox" role="switch" className="switch" checked={checked} disabled={busy} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function UpDown({ index, count, onMove, label }: { index: number; count: number; onMove: (from: number, to: number) => void; label: string }) {
  return (
    <>
      <button type="button" className="icon-btn" disabled={index === 0} aria-label={`Move ${label} up`} onClick={() => onMove(index, index - 1)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
      </button>
      <button type="button" className="icon-btn" disabled={index === count - 1} aria-label={`Move ${label} down`} onClick={() => onMove(index, index + 1)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
    </>
  );
}

export function move<T>(list: T[], from: number, to: number): T[] {
  const out = list.slice();
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
}

export { shrinkImage, upload } from "../images";

/** "2026-10-18" → "18 Oct"; null → "Never". */
export function shortDate(d: string | null): string {
  if (!d) return "Never";
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}
