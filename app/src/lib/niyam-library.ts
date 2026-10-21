// Ready-made niyams an admin can add with one tap. Names in English and Hindi; the admin can
// change anything after adding. Icons are names from NIYAM_ICONS (src/client/admin/icons.tsx).
import type { NiyamInput } from "./admin-types";

type LibraryItem = Pick<NiyamInput, "name" | "nameHi" | "type" | "target" | "options" | "icon" | "note">;

const yesno = (name: string, nameHi: string, icon: string, note: string | null = null): LibraryItem =>
  ({ name, nameHi, type: "yesno", target: null, options: [], icon, note });

export const NIYAM_LIBRARY: LibraryItem[] = [
  yesno("Navkarsi", "नवकारसी", "sun", "No food or water until 48 minutes after sunrise."),
  yesno("Porsi", "पोरसी", "sun", "No food or water until about 3 hours after sunrise."),
  yesno("Chauvihar", "चौविहार", "moon", "Nothing to eat or drink after sunset."),
  yesno("Jinpuja", "जिनपूजा", "temple"),
  yesno("Darshan", "दर्शन", "temple", "Visit the temple for darshan."),
  { name: "Navkar jaap", nameHi: "नवकार जाप", type: "count", target: 108, options: [], icon: "mala", note: "Count on a mala." },
  { name: "Samayik", nameHi: "सामायिक", type: "duration", target: 48, options: [], icon: "clock", note: "48 minutes of equanimity." },
  { name: "Swadhyay", nameHi: "स्वाध्याय", type: "duration", target: 30, options: [], icon: "book", note: "Read or study scripture." },
  yesno("Pratikraman", "प्रतिक्रमण", "hands"),
  yesno("Kandmool tyag", "कंदमूल त्याग", "leaf", "No root vegetables today."),
  yesno("Boiled water only", "उकाला पानी", "water", "Drink only boiled water."),
  {
    name: "Tapasya", nameHi: "तपस्या", type: "choice", target: null, icon: "star", note: "Which tapasya did you do today?",
    options: [
      { value: "ekasna", en: "Ekasna", hi: "एकासना" },
      { value: "biyasna", en: "Biyasna", hi: "बियासना" },
      { value: "ayambil", en: "Ayambil", hi: "आयंबिल" },
      { value: "upvas", en: "Upvas", hi: "उपवास" },
    ],
  },
];

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** One line that says when and for whom a niyam runs, e.g. "Every day · All classes · Counts in progress". */
export function niyamSummary(n: Pick<NiyamInput, "type" | "target" | "schedule" | "weekdays" | "startDate" | "endDate" | "allClasses" | "classIds" | "isCore">, classNames?: Map<string, string>): string {
  const what = n.type === "count" ? `Target ${n.target}` : n.type === "duration" ? `${n.target} min` : null;
  const when = n.schedule === "daily" ? "Every day"
    : n.schedule === "weekdays" ? [...n.weekdays].sort().map((d) => WEEKDAYS[d]).join(", ")
    : `${fmt(n.startDate)} to ${fmt(n.endDate)}`;
  const who = n.allClasses ? "All classes"
    : n.classIds.length === 1 && classNames?.get(n.classIds[0]) ? classNames.get(n.classIds[0])!
    : `${n.classIds.length} classes`;
  return [what, when, who, n.isCore ? null : "Optional"].filter(Boolean).join(" · ");
}

function fmt(d: string | null) {
  if (!d) return "?";
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}
