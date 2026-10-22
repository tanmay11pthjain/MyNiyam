// Line icons for the admin screens. One stroke style; colour comes from currentColor.
import type { ReactNode } from "react";

const S = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);

export const Icon = {
  home: () => <S><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></S>,
  people: () => <S><circle cx="9" cy="8" r="3.2" /><path d="M3 20c.6-3.4 3-5.4 6-5.4s5.4 2 6 5.4" /><circle cx="17" cy="9" r="2.4" /><path d="M16 14.2c2.6.1 4.4 1.9 5 4.8" /></S>,
  niyam: () => <S><path d="M12 3c2.6 3 3.6 5.2 3.6 7.2A3.6 3.6 0 0 1 12 14a3.6 3.6 0 0 1-3.6-3.8C8.4 8.2 9.4 6 12 3z" /><path d="M4 16h16c-.7 3.2-4 5-8 5s-7.3-1.8-8-5z" /></S>,
  setup: () => <S><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></S>,
  qr: () => <S><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3M21 14v.01M14 21h3M21 18v3h-1" /></S>,
  plus: () => <S><path d="M12 5v14M5 12h14" /></S>,
  check: () => <S><path d="M5 12.5l4.5 4.5L19 7.5" /></S>,
  roll: () => <S><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V3h6v1" /><path d="M8.5 13l2.5 2.5 4.5-5" /></S>,
  copy: () => <S><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></S>,
  share: () => <S><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" /><path d="M12 3v12M7 8l5-5 5 5" /></S>,
  download: () => <S><path d="M12 3v12M7 10l5 5 5-5" /><path d="M4 19h16" /></S>,
  print: () => <S><path d="M6 9V3h12v6" /><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M6 14h12v7H6z" /></S>,
  edit: () => <S><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z" /></S>,
  trash: () => <S><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></S>,
  search: () => <S><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></S>,
  refresh: () => <S><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></S>,
  form: () => <S><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></S>,
  layers: () => <S><path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" /></S>,
  megaphone: () => <S><path d="M3 10v4a1 1 0 0 0 1 1h3l6 4V5L7 9H4a1 1 0 0 0-1 1z" /><path d="M17 8.5a5 5 0 0 1 0 7" /></S>,
  shield: () => <S><path d="M12 3l8 3v6c0 4.6-3.4 8.2-8 9-4.6-.8-8-4.4-8-9V6l8-3z" /><path d="M9 12l2 2 4-4" /></S>,
};

// Niyam icons. Stored by name in niyams.icon.
export const NIYAM_ICONS: Record<string, () => ReactNode> = {
  sun: () => <S><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></S>,
  moon: () => <S><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></S>,
  temple: () => <S><path d="M12 2v3M8 9l4-4 4 4M5 21V11h14v10M3 21h18M10 21v-5h4v5" /></S>,
  mala: () => <S><circle cx="12" cy="10" r="7" /><circle cx="12" cy="20" r="2" /><path d="M12 17v1" /></S>,
  book: () => <S><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5z" /><path d="M4 19a2 2 0 0 1 2-2h13" /></S>,
  lamp: () => <S><path d="M12 3c2 2.4 2.8 4 2.8 5.6A2.8 2.8 0 0 1 12 11.4a2.8 2.8 0 0 1-2.8-2.8C9.2 7 10 5.4 12 3z" /><path d="M4 14h16c-.7 3.4-4 5.5-8 5.5S4.7 17.4 4 14z" /></S>,
  hands: () => <S><path d="M12 21V9.5L9 4.5a1.4 1.4 0 0 0-2.5 1.3L8 9l-2 6 3 6M12 21V9.5l3-5a1.4 1.4 0 0 1 2.5 1.3L16 9l2 6-3 6" /></S>,
  water: () => <S><path d="M12 3s6 6.7 6 11a6 6 0 0 1-12 0c0-4.3 6-11 6-11z" /></S>,
  nofood: () => <S><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></S>,
  clock: () => <S><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></S>,
  leaf: () => <S><path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15" /><path d="M5 19l7-7" /></S>,
  star: () => <S><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3z" /></S>,
};
export const NIYAM_ICON_NAMES = Object.keys(NIYAM_ICONS);

export function NiyamIcon({ name }: { name: string | null }) {
  const draw = (name && NIYAM_ICONS[name]) || NIYAM_ICONS.lamp;
  return <span className="niyam-icon">{draw()}</span>;
}
