// The sangh admin's sign-up questions (sanghs.form_fields) and how answers are checked.
// Shared by the server (validation) and the client (rendering).
import { z } from "zod";

const label = z.object({ en: z.string().min(1).max(80), hi: z.string().max(80).optional() });

const base = {
  key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  label,
  required: z.boolean().default(false),
};

// DOB ("date") and location ("location") exist only when an admin adds them to the form.
// Photo questions are not supported yet (they need object storage); unknown types are ignored.
export const formFieldSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("text"), max: z.number().int().min(1).max(200).default(80), placeholder: z.string().max(60).optional() }),
  z.object({ ...base, type: z.literal("number"), min: z.number().optional(), max: z.number().optional() }),
  z.object({ ...base, type: z.literal("date") }),
  z.object({ ...base, type: z.literal("location"), placeholder: z.string().max(60).optional() }),
  z.object({
    ...base,
    type: z.literal("select"),
    options: z.array(z.object({ value: z.string().min(1).max(40), en: z.string().min(1).max(60), hi: z.string().max(60).optional() })).min(1).max(30),
  }),
]);
export type FormField = z.infer<typeof formFieldSchema>;

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

export type Answers = Record<string, string | number>;
export type AnswerErrors = Record<string, string>;

/** Checks answers against the fields. Returns cleaned answers (only known keys) or per-field errors. */
export function validateAnswers(fields: FormField[], input: Record<string, unknown>, today = new Date()):
  { ok: true; answers: Answers } | { ok: false; errors: AnswerErrors } {
  const answers: Answers = {};
  const errors: AnswerErrors = {};
  for (const f of fields) {
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
    }
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, answers };
}
