"use client";
import { useState } from "react";
import { fieldError } from "./api";
import { Msg } from "./ui";
import type { ClassItem } from "@/lib/api-types";
import type { FormField } from "@/lib/forms";

// The pathshala's join form, field by field, in the admin's order. Used by the member's setup
// screen and, read-only, by the admin's live preview, so both always look the same.

export type JoinValues = { classId: string | null; photoUrl: string | null; answers: Record<string, string> };

export const ageHint = (c: { ageMin?: number | null; ageMax?: number | null }) =>
  c.ageMin != null && c.ageMax != null ? `Age ${c.ageMin} to ${c.ageMax}` : c.ageMin != null ? `Age ${c.ageMin}+` : c.ageMax != null ? `Up to age ${c.ageMax}` : null;

export function JoinForm({ fields, classes, values, errors, onChange, onPhoto, preview }: {
  fields: FormField[];
  classes: ClassItem[];
  values: JoinValues;
  errors: Record<string, string>;
  onChange: (v: JoinValues, touched: string) => void;
  onPhoto?: (file: File) => Promise<boolean>;
  preview?: boolean;
}) {
  return (
    <div className="stack-lg">
      {fields.map((f) => {
        const error = errors[f.key];
        if (f.type === "class") {
          // Hidden classes are not offered to new joins; someone already in one keeps seeing it.
          const shown = classes.filter((c) => !c.hidden || c.id === values.classId);
          return (
            <div key={f.key} className="stack">
              <Label field={f} as="span" id={`f-${f.key}`} />
              <div className="stack" role="radiogroup" aria-labelledby={`f-${f.key}`}>
                {shown.map((c) => {
                  const hint = [c.nameHi, ageHint(c)].filter(Boolean).join(" · ");
                  return (
                    <button key={c.id} type="button" role="radio" className="choice" aria-checked={values.classId === c.id} tabIndex={preview ? -1 : undefined}
                      onClick={() => onChange({ ...values, classId: c.id }, f.key)}>
                      <span className="radio-dot" aria-hidden="true" />
                      <span className="grow"><span className="t">{c.name}</span>{hint && <span className="s" lang={c.nameHi ? "hi" : undefined}>{hint}</span>}</span>
                    </button>
                  );
                })}
                {shown.length === 0 && <div className="notice"><b>No classes yet</b><span>Your pathshala hasn&apos;t added classes. Ask your teacher.</span></div>}
              </div>
              <ErrorLine id={`f-${f.key}-msg`} error={error} />
            </div>
          );
        }
        if (f.type === "photo") return <PhotoField key={f.key} field={f} url={values.photoUrl} error={error} onPhoto={onPhoto} preview={preview} />;
        return (
          <Field key={f.key} field={f} value={values.answers[f.key] ?? ""} error={error} preview={preview}
            onChange={(v) => onChange({ ...values, answers: { ...values.answers, [f.key]: v } }, f.key)} />
        );
      })}
    </div>
  );
}

function Label({ field: f, as = "label", id }: { field: FormField; as?: "label" | "span"; id: string }) {
  const inner = <>{f.label.en} {f.label.hi && <span className="hi" lang="hi">{f.label.hi}</span>} {!f.required && <span className="opt">(optional)</span>}</>;
  return as === "label" ? <label className="label" htmlFor={id}>{inner}</label> : <span className="label" id={id}>{inner}</span>;
}

function ErrorLine({ id, error }: { id: string; error?: string }) {
  const words = error ? fieldError[error] ?? fieldError.required : null;
  return <Msg id={id} text={words} />;
}

function PhotoField({ field: f, url, error, onPhoto, preview }: { field: FormField; url: string | null; error?: string; onPhoto?: (file: File) => Promise<boolean>; preview?: boolean }) {
  const [busy, setBusy] = useState(false);
  const id = `f-${f.key}`;
  return (
    <div className="stack">
      <Label field={f} as="span" id={`${id}-l`} />
      <div style={{ display: "flex", alignItems: "center", gap: "var(--s-4)" }}>
        <span className="avatar" style={{ width: 72, height: 72, overflow: "hidden" }} aria-hidden="true">{url ? <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : "+"}</span>
        <input id={id} type="file" accept="image/*" className="sr-only" disabled={preview || busy} aria-labelledby={`${id}-l`}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file || !onPhoto) return;
            setBusy(true);
            await onPhoto(file);
            setBusy(false);
            e.target.value = "";
          }} />
        <label htmlFor={id} className="btn btn-secondary" style={{ width: "auto", flex: 1 }} aria-busy={busy || undefined}>
          {busy && <span className="spinner" aria-hidden="true" />}{url ? "Change photo" : "Add a photo"}
        </label>
      </div>
      <ErrorLine id={`${id}-msg`} error={error} />
    </div>
  );
}

function Field({ field: f, value, error, preview, onChange }: { field: FormField; value: string; error?: string; preview?: boolean; onChange: (v: string) => void }) {
  const id = `f-${f.key}`;
  const [locating, setLocating] = useState<"idle" | "busy" | "denied">("idle");
  const common = { id, "aria-invalid": error ? true : undefined, "aria-describedby": `${id}-msg`, tabIndex: preview ? -1 : undefined } as const;

  if (f.type === "select" || f.type === "yesno") {
    const options = f.type === "yesno" ? [{ value: "yes", en: "Yes", hi: "हाँ" }, { value: "no", en: "No", hi: "नहीं" }] : f.options;
    if (options.length <= 5) {
      return (
        <div className="stack">
          <Label field={f} as="span" id={id} />
          <div className="chips" role="group" aria-labelledby={id}>
            {options.map((o) => (
              <button key={o.value} type="button" className="chip" aria-pressed={value === o.value} tabIndex={preview ? -1 : undefined}
                onClick={() => onChange(value === o.value ? "" : o.value)}>{o.en}</button>
            ))}
          </div>
          <ErrorLine id={`${id}-msg`} error={error} />
        </div>
      );
    }
    return (
      <div className="stack">
        <Label field={f} id={id} />
        <select {...common} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.en}{o.hi ? ` · ${o.hi}` : ""}</option>)}
        </select>
        <ErrorLine id={`${id}-msg`} error={error} />
      </div>
    );
  }

  if (f.type === "gps") {
    return (
      <div className="stack">
        <Label field={f} as="span" id={id} />
        {value ? (
          <div className="chips"><span className="pill kesar">Location saved</span><button type="button" className="chip" onClick={() => onChange("")}>Remove</button></div>
        ) : (
          <button type="button" className="btn btn-secondary" aria-describedby={`${id}-msg`} aria-busy={locating === "busy" || undefined} disabled={preview}
            onClick={() => {
              if (!navigator.geolocation) { setLocating("denied"); return; }
              setLocating("busy");
              navigator.geolocation.getCurrentPosition(
                (p) => { setLocating("idle"); onChange(`${p.coords.latitude.toFixed(5)},${p.coords.longitude.toFixed(5)}`); },
                () => setLocating("denied"),
                { enableHighAccuracy: false, timeout: 15000 },
              );
            }}>
            {locating === "busy" && <span className="spinner" aria-hidden="true" />}Use my current location
          </button>
        )}
        {locating === "denied" && <p className="hint">Location is blocked or unavailable. Allow it for this site in your browser settings{f.required ? "" : ", or skip this"}.</p>}
        <ErrorLine id={`${id}-msg`} error={error} />
      </div>
    );
  }

  let control;
  if (f.type === "date") {
    control = <input {...common} className="input" type="date" value={value} max={new Date().toISOString().slice(0, 10)} onChange={(e) => onChange(e.target.value)} />;
  } else if (f.type === "number") {
    control = <input {...common} className="input" inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value)} />;
  } else {
    control = <input {...common} className="input" value={value} placeholder={"placeholder" in f ? f.placeholder : f.type === "location" ? "Your area or town" : undefined}
      maxLength={f.type === "text" ? f.max : 80} autoComplete={f.type === "location" ? "address-level2" : "off"} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <div className="stack">
      <Label field={f} id={id} />
      {control}
      <ErrorLine id={`${id}-msg`} error={error} />
    </div>
  );
}
