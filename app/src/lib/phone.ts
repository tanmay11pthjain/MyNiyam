// Indian mobile numbers only, stored as E.164 (+91 followed by 10 digits starting 6 to 9).

/** Turns what a person typed ("98200 12345", "+91-9820012345", "09820012345") into +919820012345, or null. */
export function normalizeIndianPhone(input: string): string | null {
  let digits = input.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (!/^[6-9]\d{9}$/.test(digits)) return null;
  return `+91${digits}`;
}

/** "+919820012345" → "+91 98200 12345" */
export function formatPhone(e164: string): string {
  const d = e164.replace(/^\+91/, "");
  return `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
}

/** "+919820012345" → "+91 98•••••345" for screens that should not show the whole number. */
export function maskPhone(e164: string): string {
  const d = e164.replace(/^\+91/, "");
  return `+91 ${d.slice(0, 2)}•••••${d.slice(7)}`;
}
