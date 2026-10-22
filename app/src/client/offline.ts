"use client";
import { api } from "./api";
import type { LogPatch } from "./NiyamCard";

// Working without internet. Taps made offline wait in a queue on this phone and are sent, in order,
// when the connection is back. The last Today screen and the account are kept too, so the app still
// opens offline. Everything here is per phone (localStorage) and never trusted by the server: each
// queued tap goes through /api/log like any other, with the same day window.

export type Queued = { profileId: string; niyamId: string; date: string; patch: LogPatch };

const QUEUE = "mn.queue.v1";
const read = <T,>(key: string, fallback: T): T => {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
};
const write = (key: string, v: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage full or blocked: the queue just stays in memory */ }
};

/** A saved copy of an API answer (Today, the account), for opening the app offline. */
export const saveCopy = (key: string, v: unknown) => write(`mn.copy.${key}`, v);
export const readCopy = <T,>(key: string): T | null => read<T | null>(`mn.copy.${key}`, null);

export const queued = (): Queued[] => read<Queued[]>(QUEUE, []);

/** Adds a tap to the queue. Each patch holds the whole new state, so a later tap on the same niyam and day replaces an earlier one. */
export function enqueue(q: Queued) {
  const rest = queued().filter((x) => !(x.profileId === q.profileId && x.niyamId === q.niyamId && x.date === q.date));
  write(QUEUE, [...rest, q]);
  notify();
}

type Listener = () => void;
const listeners = new Set<Listener>();
const notify = () => listeners.forEach((l) => l());
export function onQueueChange(l: Listener) { listeners.add(l); return () => { listeners.delete(l); }; }

let flushing: Promise<FlushResult> | null = null;
export type FlushResult = { sent: number; refused: number; offline: boolean };

/**
 * Sends queued taps one by one, oldest first. Stops at the first network failure (still offline).
 * A tap the server refuses (for example the day has closed) is dropped and counted as refused.
 */
export function flushQueue(): Promise<FlushResult> {
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0, refused = 0;
    for (;;) {
      const [q] = queued();
      if (!q) break;
      const r = await api("/api/log", { body: { profileId: q.profileId, niyamId: q.niyamId, date: q.date, ...q.patch } });
      if (!r.ok && r.err.error === "offline") return { sent, refused, offline: true };
      if (!r.ok && r.err.error === "unauthorized") return { sent, refused, offline: false }; // keep them for after login
      // Take it off the front, unless a newer tap on the same niyam replaced it meanwhile (that one is sent next).
      const now = queued();
      if (now[0] && JSON.stringify(now[0]) === JSON.stringify(q)) write(QUEUE, now.slice(1));
      if (r.ok) sent++; else refused++;
      notify();
    }
    return { sent, refused, offline: false };
  })().finally(() => { flushing = null; });
  return flushing;
}

/** Registers the service worker that keeps the app's screens and files for offline use (production only). */
export function registerServiceWorker() {
  if (process.env.NODE_ENV !== "production" || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.register("/sw.js").catch(() => { /* offline opening just won't work on this browser */ });
}

/** Forgets this phone's saved copies and unsent taps (on log out, or after deleting the account). */
export function clearOfflineData() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("mn.")) localStorage.removeItem(k);
  } catch { /* nothing saved */ }
}
