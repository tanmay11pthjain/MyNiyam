// Pathshala join codes: 6 letters or numbers, case-insensitive (stored upper-case).
export const JOIN_CODE_LENGTH = 6;

/** Upper-cases and strips spaces and dashes. Returns null unless it is exactly 6 letters/numbers. */
export function normalizeJoinCode(input: string): string | null {
  const code = input.replace(/[\s-]/g, "").toUpperCase();
  return /^[A-Z0-9]{6}$/.test(code) ? code : null;
}

/**
 * Reads a code out of whatever a QR code held: a join link (https://…/j/HEER01,
 * …/join?code=HEER01) or the bare code itself.
 */
export function joinCodeFromScan(text: string): string | null {
  const raw = text.trim();
  try {
    const url = new URL(raw);
    const fromPath = url.pathname.match(/\/j\/([A-Za-z0-9-]+)\/?$/);
    if (fromPath) return normalizeJoinCode(fromPath[1]);
    const fromQuery = url.searchParams.get("code");
    if (fromQuery) return normalizeJoinCode(fromQuery);
    return null;
  } catch {
    return normalizeJoinCode(raw);
  }
}
