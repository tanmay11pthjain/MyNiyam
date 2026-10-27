// Badges: what can be earned, and the rule for each. Pure, so the server and tests share it.
// They reward showing up (streaks, days kept), firsts in tapasya (never totals, so nobody competes
// on tapasya), attendance, and finishing a pathshala challenge. Each is earned once.

export type BadgeKind = "streak" | "days" | "tej" | "tapasya" | "attendance" | "challenge";
export type BadgeDef = { id: string; kind: BadgeKind; en: string; hi: string; mark: string };

export const BADGES: BadgeDef[] = [
  { id: "streak_7", kind: "streak", en: "7-day streak", hi: "7 दिन लगातार", mark: "7" },
  { id: "streak_21", kind: "streak", en: "21-day streak", hi: "21 दिन लगातार", mark: "21" },
  { id: "streak_48", kind: "streak", en: "48-day streak", hi: "48 दिन लगातार", mark: "48" },
  { id: "streak_108", kind: "streak", en: "108-day streak", hi: "108 दिन लगातार", mark: "108" },
  { id: "days_30", kind: "days", en: "30 days of niyams", hi: "30 दिन नियम", mark: "30" },
  { id: "days_108", kind: "days", en: "108 days of niyams", hi: "108 दिन नियम", mark: "108" },
  { id: "tej_1000", kind: "tej", en: "1,000 Tej", hi: "1,000 तेज", mark: "✦" },
  { id: "tej_5000", kind: "tej", en: "5,000 Tej", hi: "5,000 तेज", mark: "✦" },
  { id: "first_ekasana", kind: "tapasya", en: "First Ekasana", hi: "पहला एकासना", mark: "१" },
  { id: "first_ayambil", kind: "tapasya", en: "First Ayambil", hi: "पहला आयंबिल", mark: "१" },
  { id: "first_upvas", kind: "tapasya", en: "First Upvas", hi: "पहला उपवास", mark: "१" },
  { id: "attendance_month", kind: "attendance", en: "Full attendance month", hi: "पूरे महीने हाज़िर", mark: "✓" },
];

const BY_ID = new Map(BADGES.map((b) => [b.id, b]));

/** A challenge's badge id. */
export const challengeBadge = (goalId: string) => `challenge:${goalId}`;

/** Words for any badge id, including a challenge's (its title comes from the goal). */
export function badgeInfo(id: string, challengeTitle?: string): BadgeDef {
  const b = BY_ID.get(id);
  if (b) return b;
  if (id.startsWith("challenge:")) return { id, kind: "challenge", en: challengeTitle ? `Finished: ${challengeTitle}` : "Finished a challenge", hi: "चुनौती पूरी", mark: "★" };
  return { id, kind: "days", en: "Badge", hi: "बैज", mark: "✦" };
}

// Spellings members and admins use for the three tapasya firsts (option or niyam names).
const TAPASYA: [string, RegExp][] = [
  ["first_ekasana", /eka?s(a|h)?na|एकास/i],
  ["first_ayambil", /aya?mb(i|e)l|आयंबिल|आयम्बिल/i],
  ["first_upvas", /upa?vas|upwas|उपवास/i],
];

export type BadgeFacts = {
  best: number;          // best streak ever
  daysKept: number;      // days with at least one niyam kept
  tej: number;
  tapasyaNames: string[]; // names of tapasya levels and niyams kept (choice options and yes/no niyams)
  fullAttendanceMonth: boolean;
  challengesDone: string[]; // goal ids
};

/** Every badge these facts have earned. */
export function earnedBadges(f: BadgeFacts): string[] {
  const out: string[] = [];
  for (const n of [7, 21, 48, 108]) if (f.best >= n) out.push(`streak_${n}`);
  for (const n of [30, 108]) if (f.daysKept >= n) out.push(`days_${n}`);
  for (const n of [1000, 5000]) if (f.tej >= n) out.push(`tej_${n}`);
  for (const [id, re] of TAPASYA) if (f.tapasyaNames.some((s) => re.test(s))) out.push(id);
  if (f.fullAttendanceMonth) out.push("attendance_month");
  for (const g of f.challengesDone) out.push(challengeBadge(g));
  return out;
}

/** The preset Anumodana messages. No free text, so the feed stays safe without moderation. */
export const ANUMODANA_MSGS = [
  { en: "Anumodana", hi: "अनुमोदना" },
  { en: "Bahut anumodana", hi: "बहुत अनुमोदना" },
  { en: "Sukh shata", hi: "सुख शाता" },
  { en: "Jai Jinendra", hi: "जय जिनेन्द्र" },
] as const;
