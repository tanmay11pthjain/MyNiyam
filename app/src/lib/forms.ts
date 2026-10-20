// The sangh admin's join form (sanghs.form_fields) and how answers are checked.
// Shared by the server (validation), the join screen (rendering) and the admin form builder.
import { z } from "zod";

const label = z.object({ en: z.string().trim().min(1).max(80), hi: z.string().trim().max(80).optional() });

const base = {
  key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  label,
  required: z.boolean().default(false),
};

const option = z.object({ value: z.string().min(1).max(40), en: z.string().trim().min(1).max(60), hi: z.string().trim().max(60).optional() });

// "class" is answered by picking a class (profiles.class_id) and "photo" by uploading one
// (profiles.photo_url); every other type is stored in profile_answers. Unknown types are ignored.
export const formFieldSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("class") }),
  z.object({ ...base, type: z.literal("text"), max: z.number().int().min(1).max(200).default(80), placeholder: z.string().max(60).optional() }),
  z.object({ ...base, type: z.literal("number"), min: z.number().optional(), max: z.number().optional() }),
  z.object({ ...base, type: z.literal("date") }),
  z.object({ ...base, type: z.literal("location"), placeholder: z.string().max(60).optional() }),
  z.object({ ...base, type: z.literal("select"), options: z.array(option).min(1).max(30) }),
  z.object({ ...base, type: z.literal("yesno") }),
  z.object({ ...base, type: z.literal("photo") }),
  z.object({ ...base, type: z.literal("gps") }),
]);
export type FormField = z.infer<typeof formFieldSchema>;
export type FieldType = FormField["type"];

/** Keeps the fields this app knows how to show; drops anything malformed rather than breaking sign-up. */
export function parseFormFields(raw: unknown): FormField[] {
  if (!Array.isArray(raw)) return [];
  const out: FormField[] = [];
  for (const item of raw) {
    const r = formFieldSchema.safeParse(item);
    if (r.success) out.push(r.data);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Standard fields: fixed keys and types; the admin turns them on or off, marks them required and
// edits their labels. Name and the OTP-checked phone are always asked and are not form fields.
// ---------------------------------------------------------------------------
export const STANDARD_FIELDS: FormField[] = [
  { key: "class", type: "class", required: true, label: { en: "Class", hi: "कक्षा" } },
  { key: "gender", type: "select", required: false, label: { en: "Gender", hi: "लिंग" },
    options: [{ value: "male", en: "Male", hi: "पुरुष" }, { value: "female", en: "Female", hi: "महिला" }] },
  { key: "dob", type: "date", required: false, label: { en: "Date of birth", hi: "जन्म तिथि" } },
  { key: "photo", type: "photo", required: false, label: { en: "Photo", hi: "फ़ोटो" } },
  { key: "city", type: "text", required: false, max: 60, label: { en: "City", hi: "शहर" } },
  { key: "area", type: "text", required: false, max: 60, label: { en: "Area", hi: "इलाका" } },
  { key: "roll_no", type: "text", required: false, max: 20, label: { en: "Roll number", hi: "रोल नंबर" } },
  { key: "gps", type: "gps", required: false, label: { en: "Home location", hi: "घर की जगह" } },
];
const STANDARD = new Map(STANDARD_FIELDS.map((f) => [f.key, f]));
export const isStandardKey = (key: string) => STANDARD.has(key);

/** The types an admin may give a field of their own. */
export const CUSTOM_TYPES = ["text", "number", "select", "yesno"] as const;

/**
 * Checks a form the admin saves. Returns the cleaned fields, or a reason it can't be saved.
 * Standard keys keep their own type (and gender keeps its options); custom fields use the custom types.
 */
export function checkFormFields(raw: unknown): { ok: true; fields: FormField[] } | { ok: false; reason: string } {
  const r = z.array(formFieldSchema).max(30).safeParse(raw);
  if (!r.success) return { ok: false, reason: "invalid_field" };
  const seen = new Set<string>();
  const fields: FormField[] = [];
  for (const f of r.data) {
    if (seen.has(f.key)) return { ok: false, reason: "duplicate_key" };
    seen.add(f.key);
    const std = STANDARD.get(f.key);
    if (std) {
      if (std.type !== f.type) return { ok: false, reason: "invalid_field" };
      // Labels and "required" are the admin's; the rest of a standard field is fixed.
      fields.push({ ...std, label: f.label, required: f.required } as FormField);
      continue;
    }
    if (!(CUSTOM_TYPES as readonly string[]).includes(f.type)) return { ok: false, reason: "invalid_field" };
    if (f.type === "select" && new Set(f.options.map((o) => o.value)).size !== f.options.length) return { ok: false, reason: "invalid_field" };
    fields.push(f);
  }
  return { ok: true, fields };
}

export type Answers = Record<string, string | number>;
export type AnswerErrors = Record<string, string>;

const GPS = /^(-?\d{1,2}(\.\d{1,7})?),(-?\d{1,3}(\.\d{1,7})?)$/;

/**
 * Checks answers against the fields. Returns cleaned answers (only known keys) or per-field errors.
 * Class and photo are not answers (see formFieldSchema); the caller checks those.
 */
export function validateAnswers(fields: FormField[], input: Record<string, unknown>, today = new Date()):
  { ok: true; answers: Answers } | { ok: false; errors: AnswerErrors } {
  const answers: Answers = {};
  const errors: AnswerErrors = {};
  for (const f of fields) {
    if (f.type === "class" || f.type === "photo") continue;
    const v = input[f.key];
    const empty = v === undefined || v === null || (typeof v === "string" && v.trim() === "");
    if (empty) {
      if (f.required) errors[f.key] = "required";
      continue;
    }
    switch (f.type) {
      case "text":
      case "location": {
        const s = String(v).trim();
        const max = f.type === "text" ? f.max : 80;
        if (s.length > max) errors[f.key] = "too_long";
        else answers[f.key] = s;
        break;
      }
      case "number": {
        const n = typeof v === "number" ? v : Number(String(v).trim());
        if (!Number.isFinite(n)) errors[f.key] = "not_a_number";
        else if ((f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) errors[f.key] = "out_of_range";
        else answers[f.key] = n;
        break;
      }
      case "date": {
        const s = String(v);
        const d = new Date(`${s}T00:00:00Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(d.getTime())) errors[f.key] = "bad_date";
        else if (d > today || d.getUTCFullYear() < 1900) errors[f.key] = "bad_date";
        else answers[f.key] = s;
        break;
      }
      case "select": {
        const s = String(v);
        if (!f.options.some((o) => o.value === s)) errors[f.key] = "bad_option";
        else answers[f.key] = s;
        break;
      }
      case "yesno": {
        const s = String(v);
        if (s !== "yes" && s !== "no") errors[f.key] = "bad_option";
        else answers[f.key] = s;
        break;
      }
      case "gps": {
        const s = String(v).replace(/\s/g, "");
        const m = s.match(GPS);
        if (!m || Math.abs(Number(m[1])) > 90 || Math.abs(Number(m[3])) > 180) errors[f.key] = "bad_location";
        else answers[f.key] = s;
        break;
      }
    }
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, answers };
}

/**
 * The required questions a person hasn't answered yet. When an admin adds a required field, existing
 * members are asked it the next time they open the app; until then nothing else breaks.
 */
export function missingRequired(fields: FormField[], has: { answers: Record<string, unknown>; classId: string | null; photoUrl: string | null }): string[] {
  const out: string[] = [];
  for (const f of fields) {
    if (!f.required) continue;
    if (f.type === "class") { if (!has.classId) out.push(f.key); continue; }
    if (f.type === "photo") { if (!has.photoUrl) out.push(f.key); continue; }
    const v = has.answers[f.key];
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) out.push(f.key);
  }
  return out;
}

/** Whole years between a yyyy-mm-dd birth date and `today`, or null. */
export function ageFrom(dob: unknown, today = new Date()): number | null {
  if (typeof dob !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const [y, m, d] = dob.split("-").map(Number);
  let age = today.getUTCFullYear() - y;
  if (today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d)) age--;
  return age >= 0 && age < 130 ? age : null;
}
