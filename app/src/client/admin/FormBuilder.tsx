"use client";
import { useEffect, useState } from "react";
import { api } from "../api";
import { Button } from "../ui";
import { JoinForm, type JoinValues } from "../JoinFields";
import { useAdmin } from "./AdminApp";
import { Icon } from "./icons";
import { LoadError, Loading, Switch, UpDown, move, sayAdmin, useLoad, useToast } from "./kit";
import type { FormPage } from "@/lib/admin-types";
import { CUSTOM_TYPES, STANDARD_FIELDS, isStandardKey, type FormField } from "@/lib/forms";

const TYPE_NAME: Record<FormField["type"], string> = {
  class: "Class list", text: "Short text", number: "Number", date: "Date", location: "Place",
  select: "Choice", yesno: "Yes / no", photo: "Photo", gps: "Location",
};
const CUSTOM_NAME: Record<(typeof CUSTOM_TYPES)[number], string> = { text: "Short text", number: "Number", select: "Choice from a list", yesno: "Yes or no" };

const rid = () => Math.random().toString(36).slice(2, 8);

function newCustom(type: (typeof CUSTOM_TYPES)[number]): FormField {
  const base = { key: `q_${rid()}`, label: { en: "" }, required: false };
  if (type === "select") return { ...base, type, options: [{ value: `o_${rid()}`, en: "" }, { value: `o_${rid()}`, en: "" }] };
  if (type === "text") return { ...base, type, max: 80 };
  return { ...base, type } as FormField;
}

export function FormBuilder() {
  const { sangh } = useAdmin();
  const d = useLoad<FormPage>(`/api/admin/form?s=${sangh.id}`);
  if (d.state === "loading") return <div className="page"><Loading rows={5} /></div>;
  if (d.state === "error") return <div className="page"><LoadError message={d.message} retry={d.retry} /></div>;
  return <Builder key={sangh.id} page={d.data} />;
}

function Builder({ page }: { page: FormPage }) {
  const toast = useToast();
  const [saved, setSaved] = useState<FormField[]>(page.fields);
  const [fields, setFields] = useState<FormField[]>(page.fields);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [preview, setPreview] = useState<JoinValues>({ classId: null, photoUrl: null, answers: {} });
  const dirty = JSON.stringify(saved) !== JSON.stringify(fields);

  // Don't lose unsaved changes to a stray tap on the back button.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const update = (key: string, next: FormField) => { setFields(fields.map((f) => (f.key === key ? next : f))); setErr(null); };
  const missingStd = STANDARD_FIELDS.filter((s) => !fields.some((f) => f.key === s.key));

  async function save() {
    const blank = fields.find((f) => !f.label.en.trim() || (f.type === "select" && f.options.some((o) => !o.en.trim())));
    if (blank) { setOpen(blank.key); setErr("Every question and every choice needs an English name."); return; }
    setBusy(true); setErr(null);
    const r = await api<{ fields: FormField[] }>("/api/admin/form", { method: "PUT", body: { fields } });
    setBusy(false);
    if (!r.ok) { setErr(sayAdmin(r.err)); return; }
    const wasRequired = new Set(saved.filter((f) => f.required).map((f) => f.key));
    const newlyRequired = r.data.fields.filter((f) => f.required && !wasRequired.has(f.key));
    setSaved(r.data.fields); setFields(r.data.fields);
    setNote(newlyRequired.length
      ? `Members who already joined will be asked ${newlyRequired.map((f) => `"${f.label.en}"`).join(", ")} the next time they open MyNiyam. Nothing else changes for them.`
      : null);
    toast("Join form saved");
  }

  return (
    <main className="page">
      <div className="page-title"><h1 data-hi="जुड़ने का फ़ॉर्म">Join form</h1><p>What new members are asked after their name and number.</p></div>
      <div className="builder">
        <div className="stack-lg">
          <div className="stack">
            <div className="fcard locked">
              <div className="fcard-head"><span className="grow"><span style={{ font: "700 var(--fs-16) var(--font-display)" }}>Name and mobile number</span><br /><span className="type-tag">Always asked. The number is checked with a code.</span></span></div>
            </div>
            {fields.map((f, i) => (
              <FieldCard key={f.key} field={f} index={i} count={fields.length} open={open === f.key}
                onToggle={() => setOpen(open === f.key ? null : f.key)}
                onMove={(a, b) => setFields(move(fields, a, b))}
                onChange={(next) => update(f.key, next)}
                onRemove={() => { setFields(fields.filter((x) => x.key !== f.key)); setOpen(null); }} />
            ))}
          </div>

          {missingStd.length > 0 && (
            <section className="section">
              <h2>Add a common question</h2>
              <div className="chips">
                {missingStd.map((s) => (
                  <button key={s.key} type="button" className="chip" onClick={() => { setFields([...fields, { ...s }]); setOpen(s.key); }}>+ {s.label.en}</button>
                ))}
              </div>
            </section>
          )}
          <section className="section">
            <h2>Add your own question</h2>
            <div className="chips">
              {CUSTOM_TYPES.map((t) => (
                <button key={t} type="button" className="chip" onClick={() => { const f = newCustom(t); setFields([...fields, f]); setOpen(f.key); }}>+ {CUSTOM_NAME[t]}</button>
              ))}
            </div>
          </section>

          {err && <p className="msg err" role="alert">{err}</p>}
          {note && <div className="notice" role="status"><b>Saved</b><span>{note}</span></div>}
          <div className="stack">
            <Button busy={busy} disabled={!dirty} onClick={() => void save()}>{busy ? "Saving…" : dirty ? "Save join form" : "All changes saved"}</Button>
            {dirty && <Button kind="quiet" onClick={() => { setFields(saved); setErr(null); }}>Undo changes</Button>}
          </div>
        </div>

        <aside className="preview" aria-label="Preview">
          <p className="hint"><b>Preview.</b> This is what a new member sees.</p>
          <div className="phone" aria-hidden="true">
            <div>
              <h2 style={{ fontSize: "var(--fs-22)" }}>A little about you</h2>
              <p className="hint">What {page.sanghName} asks everyone who joins.</p>
            </div>
            <JoinForm preview fields={fields.filter((f) => f.label.en.trim())} classes={page.classes} values={preview} errors={{}}
              onChange={(v) => setPreview(v)} />
          </div>
        </aside>
      </div>
    </main>
  );
}

function FieldCard({ field: f, index, count, open, onToggle, onMove, onChange, onRemove }: {
  field: FormField; index: number; count: number; open: boolean;
  onToggle: () => void; onMove: (a: number, b: number) => void; onChange: (f: FormField) => void; onRemove: () => void;
}) {
  const std = isStandardKey(f.key);
  const name = f.label.en.trim() || "Untitled question";
  const id = `fc-${f.key}`;
  return (
    <div className={`fcard${open ? " open" : ""}`}>
      <div className="fcard-head">
        <button type="button" className="grow" aria-expanded={open} aria-controls={id} onClick={onToggle}
          style={{ border: 0, background: "none", textAlign: "left", cursor: "pointer", padding: "var(--s-1) 0", minHeight: 44 }}>
          <span style={{ font: "700 var(--fs-16) var(--font-display)", display: "block" }}>{name}</span>
          <span className="type-tag">{TYPE_NAME[f.type]}{f.required ? " · must answer" : " · can skip"}</span>
        </button>
        <UpDown index={index} count={count} label={name} onMove={onMove} />
        <button type="button" className="icon-btn" aria-label={`Edit ${name}`} aria-expanded={open} onClick={onToggle}><Icon.edit /></button>
      </div>
      {open && (
        <div className="fcard-body" id={id}>
          <div className="field"><label className="label" htmlFor={`${id}-en`}>Question</label>
            <input id={`${id}-en`} className="input input-sm" value={f.label.en} maxLength={80} placeholder="e.g. Which school do you go to?"
              onChange={(e) => onChange({ ...f, label: { ...f.label, en: e.target.value } })} /></div>
          <div className="field"><label className="label" htmlFor={`${id}-hi`}>In Hindi <span className="opt">(optional)</span></label>
            <input id={`${id}-hi`} lang="hi" className="input input-sm" value={f.label.hi ?? ""} maxLength={80}
              onChange={(e) => onChange({ ...f, label: { ...f.label, hi: e.target.value || undefined } })} /></div>
          {f.type === "select" && !std && <OptionsEditor field={f} onChange={onChange} />}
          {f.type === "select" && std && <p className="hint">Choices: {f.options.map((o) => o.en).join(", ")}</p>}
          <div className="list"><Switch label="Must answer" sub={f.required ? "Members can't carry on without it." : "Members may skip it."} checked={f.required} onChange={(v) => onChange({ ...f, required: v })} /></div>
          <Button kind="quiet" onClick={onRemove}>
            <span style={{ color: "var(--danger)", display: "inline-flex", gap: 8, alignItems: "center" }}><Icon.trash />{std ? "Stop asking this" : "Delete this question"}</span>
          </Button>
          {!std && <p className="hint">Answers members already gave stay saved, but no one is asked this any more.</p>}
        </div>
      )}
    </div>
  );
}

function OptionsEditor({ field: f, onChange }: { field: Extract<FormField, { type: "select" }>; onChange: (f: FormField) => void }) {
  const set = (i: number, patch: Partial<{ en: string; hi?: string }>) =>
    onChange({ ...f, options: f.options.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  return (
    <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="label">Choices</legend>
      {f.options.map((o, i) => (
        <div key={o.value} style={{ display: "flex", gap: "var(--s-2)", alignItems: "center" }}>
          <input aria-label={`Choice ${i + 1}`} className="input input-sm" value={o.en} maxLength={60} placeholder={`Choice ${i + 1}`} onChange={(e) => set(i, { en: e.target.value })} />
          <input aria-label={`Choice ${i + 1} in Hindi`} lang="hi" className="input input-sm" value={o.hi ?? ""} maxLength={60} placeholder="हिंदी" onChange={(e) => set(i, { hi: e.target.value || undefined })} />
          <button type="button" className="icon-btn" aria-label={`Remove choice ${i + 1}`} disabled={f.options.length <= 1}
            onClick={() => onChange({ ...f, options: f.options.filter((_, j) => j !== i) })}><Icon.trash /></button>
        </div>
      ))}
      {f.options.length < 30 && (
        <button type="button" className="chip" style={{ justifySelf: "start" }} onClick={() => onChange({ ...f, options: [...f.options, { value: `o_${rid()}`, en: "" }] })}>+ Add a choice</button>
      )}
    </fieldset>
  );
}
