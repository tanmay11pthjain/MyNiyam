// Display settings kept on this phone only: Hindi first, large text, and Hindi labels in the admin panel.
// They are classes on <html>, so every screen follows them without any re-render.

export type Prefs = { hiFirst: boolean; large: boolean; adminHi: boolean };
const KEY = "mn_prefs";
const CLASS: Record<keyof Prefs, string> = { hiFirst: "hi-first", large: "text-lg", adminHi: "admin-hi" };

export function readPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Prefs>;
    return { hiFirst: !!p.hiFirst, large: !!p.large, adminHi: !!p.adminHi };
  } catch {
    return { hiFirst: false, large: false, adminHi: false };
  }
}

export function applyPrefs(p: Prefs = readPrefs()) {
  for (const k of Object.keys(CLASS) as (keyof Prefs)[]) document.documentElement.classList.toggle(CLASS[k], p[k]);
}

export function savePrefs(patch: Partial<Prefs>): Prefs {
  const next = { ...readPrefs(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode: still applies for this visit */ }
  applyPrefs(next);
  return next;
}
