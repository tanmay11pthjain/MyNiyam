"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, fieldError, say } from "./api";
import { Button, Chevron, Frame, Msg, Title } from "./ui";
import type { ApiError, Me, Profile } from "@/lib/api-types";
import type { FormField } from "@/lib/forms";

type Words = { en: string; hi: string };
type View = { name: "pick" } | { name: "add" } | { name: "setup"; profile: Profile };

/** "Who is using MyNiyam?" → pick or add a person → class and the pathshala's questions → Home. */
export function WhoScreen() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loadErr, setLoadErr] = useState<Words | null>(null);
  const [view, setView] = useState<View>({ name: "pick" });

  const load = useCallback(() => api<Me>("/api/me").then((r) => {
    if (r.ok) {
      setMe(r.data);
      if (r.data.profiles.length === 0) setView({ name: "add" });
    } else if (r.err.error === "unauthorized") router.replace("/login");
    else setLoadErr(say(r.err));
  }), [router]);

  useEffect(() => { void load(); }, [load]);

  if (!me) {
    return (
      <Frame>
        <div className="screen">
          <Title en="Who is using MyNiyam?" hi="MyNiyam कौन इस्तेमाल कर रहा है?" />
          {loadErr ? (
            <div className="banner err mt-5"><span>{loadErr.en}</span><Button kind="secondary" onClick={() => { setLoadErr(null); void load(); }}>Try again</Button></div>
          ) : (
            <div className="stack mt-5" aria-busy="true"><div className="skel" /><div className="skel" /></div>
          )}
        </div>
      </Frame>
    );
  }

  const className = (id: string | null) => me.classes.find((c) => c.id === id)?.name;
  const hasSelf = me.profiles.some((p) => p.relation === "self");

  if (view.name === "add") {
    return (
      <Frame lamps={{ total: 3, lit: 2 }} onBack={me.profiles.length ? () => setView({ name: "pick" }) : undefined}>
        <AddPerson hasSelf={hasSelf} sanghName={me.sangh.name}
          onAdded={(p) => { setMe({ ...me, profiles: [...me.profiles, p] }); setView({ name: "setup", profile: p }); }} />
      </Frame>
    );
  }

  if (view.name === "setup") {
    return (
      <Frame lamps={{ total: 3, lit: 2 }} onBack={() => setView({ name: "pick" })}>
        <SetupPerson me={me} profile={view.profile} onDone={() => router.push("/home")} />
      </Frame>
    );
  }

  return (
    <Frame>
      <div className="screen">
        <Title en="Who is using MyNiyam?" hi="MyNiyam कौन इस्तेमाल कर रहा है?" lead={<>{me.sangh.name} · {me.phone}</>} />
        <PickList profiles={me.profiles} className={className} onPicked={(p) => (p.setupDone ? router.push("/home") : setView({ name: "setup", profile: p }))} />
        <div className="stack push">
          <Button kind="secondary" onClick={() => setView({ name: "add" })}>Add someone on this number</Button>
        </div>
      </div>
    </Frame>
  );
}

function PickList({ profiles, className, onPicked }: { profiles: Profile[]; className: (id: string | null) => string | undefined; onPicked: (p: Profile) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<Words | null>(null);
  return (
    <div className="stack mt-5">
      {profiles.map((p) => (
        <button key={p.id} type="button" className="choice" disabled={busy !== null} aria-busy={busy === p.id || undefined}
          onClick={async () => {
            setBusy(p.id); setErr(null);
            const r = await api("/api/session/profile", { body: { profileId: p.id } });
            setBusy(null);
            if (r.ok) onPicked(p); else setErr(say(r.err));
          }}>
          <span className={`avatar${p.relation === "self" ? " kesar" : ""}`} aria-hidden="true">{p.name.charAt(0).toUpperCase()}</span>
          <span className="grow">
            <span className="t">{p.name}</span>
            <span className="s">{p.relation === "self" ? "Myself" : "My child"}{className(p.classId) ? ` · ${className(p.classId)}` : " · class not chosen yet"}</span>
          </span>
          {busy === p.id ? <span className="spinner" aria-hidden="true" /> : <Chevron />}
        </button>
      ))}
      <Msg text={err} />
    </div>
  );
}

function AddPerson({ hasSelf, sanghName, onAdded }: { hasSelf: boolean; sanghName: string; onAdded: (p: Profile) => void }) {
  const [relation, setRelation] = useState<"self" | "child" | null>(hasSelf ? "child" : null);
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Words | null>(null);
  const [consentErr, setConsentErr] = useState(false);

  async function save() {
    if (!relation) return;
    if (!name.trim()) { setErr({ en: "Please write a name.", hi: "नाम लिखें।" }); return; }
    if (relation === "child" && !consent) { setConsentErr(true); setErr(say({ error: "consent_required" })); return; }
    setBusy(true); setErr(null);
    const r = await api<{ profile: Profile }>("/api/profiles", { body: { name: name.trim(), relation, consent } });
    setBusy(false);
    if (r.ok) onAdded(r.data.profile);
    else setErr(say(r.err as ApiError));
  }

  return (
    <div className="screen">
      <Title en="Who is using MyNiyam?" hi="MyNiyam कौन इस्तेमाल कर रहा है?" lead="You can add your children on this same number." />
      <div className="stack mt-5" role="radiogroup" aria-label="Who is this for">
        {!hasSelf && (
          <button type="button" role="radio" className="choice" aria-checked={relation === "self"} onClick={() => setRelation("self")}>
            <span className="radio-dot" aria-hidden="true" />
            <span className="grow"><span className="t">Myself</span><span className="s" lang="hi">मैं खुद</span></span>
          </button>
        )}
        <button type="button" role="radio" className="choice" aria-checked={relation === "child"} onClick={() => setRelation("child")}>
          <span className="radio-dot" aria-hidden="true" />
          <span className="grow"><span className="t">My child</span><span className="s" lang="hi">मेरा बच्चा</span></span>
        </button>
      </div>

      {relation && (
        <form className="stack mt-5" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <label className="label" htmlFor="pname">
            {relation === "self" ? <>Your name <span className="hi" lang="hi">आपका नाम</span></> : <>Child&apos;s name <span className="hi" lang="hi">बच्चे का नाम</span></>}
          </label>
          <input id="pname" className="input" value={name} maxLength={60} autoComplete={relation === "self" ? "name" : "off"} autoCapitalize="words"
            onChange={(e) => { setName(e.target.value); setErr(null); }} />
          {relation === "child" && (
            <label className="check" data-invalid={consentErr || undefined}>
              <input type="checkbox" checked={consent} onChange={(e) => { setConsent(e.target.checked); setConsentErr(false); setErr(null); }} />
              <span>
                I am this child&apos;s parent or guardian and I own this mobile number. I agree that MyNiyam keeps my child&apos;s name and niyam record for {sanghName}.
                <span className="hi" lang="hi" style={{ display: "block", marginTop: 4 }}>मैं इस बच्चे का माता-पिता/अभिभावक हूँ और यह नंबर मेरा है। मैं सहमति देता/देती हूँ कि MyNiyam मेरे बच्चे का नाम और नियम रिकॉर्ड रखे।</span>
              </span>
            </label>
          )}
          <Msg text={err} />
          <Button type="submit" busy={busy}>{busy ? "Saving…" : "Continue"}</Button>
        </form>
      )}
    </div>
  );
}

function SetupPerson({ me, profile, onDone }: { me: Me; profile: Profile; onDone: () => void }) {
  const [classId, setClassId] = useState<string | null>(profile.classId);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Words | null>(null);

  async function finish() {
    if (!classId) { setErr({ en: "Please pick a class.", hi: "कक्षा चुनें।" }); return; }
    const missing = Object.fromEntries(me.formFields.filter((f) => f.required && !answers[f.key]?.trim()).map((f) => [f.key, "required"]));
    if (Object.keys(missing).length) { setFieldErrs(missing); setErr(say({ error: "invalid_answers" })); return; }
    setBusy(true); setErr(null); setFieldErrs({});
    const r = await api<{ profile: Profile }>(`/api/profiles/${profile.id}`, { method: "PATCH", body: { classId, answers } });
    setBusy(false);
    if (r.ok) onDone();
    else {
      const e = r.err as ApiError;
      if (e.fields) setFieldErrs(e.fields);
      setErr(say(r.err));
    }
  }

  const self = profile.relation === "self";
  return (
    <div className="screen">
      <Title en={self ? "Pick your class" : `Pick ${profile.name}'s class`} hi="कक्षा चुनें" lead={`Your class at ${me.sangh.name}.`} />
      <div className="stack mt-5" role="radiogroup" aria-label="Class">
        {me.classes.map((c) => (
          <button key={c.id} type="button" role="radio" className="choice" aria-checked={classId === c.id} onClick={() => { setClassId(c.id); setErr(null); }}>
            <span className="radio-dot" aria-hidden="true" />
            <span className="grow"><span className="t">{c.name}</span>{c.nameHi && <span className="s" lang="hi">{c.nameHi}</span>}</span>
          </button>
        ))}
        {me.classes.length === 0 && <div className="notice"><b>No classes yet</b><span>Your pathshala hasn&apos;t added classes. Ask your teacher.</span></div>}
      </div>

      {me.formFields.length > 0 && (
        <div className="stack-lg mt-6">
          {me.formFields.map((f) => (
            <Field key={f.key} field={f} value={answers[f.key] ?? ""} error={fieldErrs[f.key]}
              onChange={(v) => { setAnswers({ ...answers, [f.key]: v }); setFieldErrs({ ...fieldErrs, [f.key]: "" }); }} />
          ))}
        </div>
      )}

      <div className="stack push">
        <Msg text={err} />
        <Button busy={busy} onClick={() => void finish()}>{busy ? "Saving…" : "Finish and open MyNiyam"}</Button>
      </div>
    </div>
  );
}

function Field({ field: f, value, error, onChange }: { field: FormField; value: string; error?: string; onChange: (v: string) => void }) {
  const id = `f-${f.key}`;
  const words = error ? fieldError[error] ?? fieldError.required : null;
  const label = (
    <label className="label" htmlFor={id}>
      {f.label.en} {f.label.hi && <span className="hi" lang="hi">{f.label.hi}</span>} {!f.required && <span className="opt">(optional)</span>}
    </label>
  );
  const common = { id, "aria-invalid": error ? true : undefined, "aria-describedby": `${id}-msg` } as const;
  let control;
  if (f.type === "select") {
    control = f.options.length <= 5 ? (
      <div className="chips" role="group" aria-labelledby={id}>
        {f.options.map((o) => (
          <button key={o.value} type="button" className="chip" aria-pressed={value === o.value} onClick={() => onChange(value === o.value ? "" : o.value)}>{o.en}</button>
        ))}
      </div>
    ) : (
      <select {...common} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {f.options.map((o) => <option key={o.value} value={o.value}>{o.en}{o.hi ? ` · ${o.hi}` : ""}</option>)}
      </select>
    );
    if (f.options.length <= 5) {
      return (
        <div className="stack">
          <span className="label" id={id}>{f.label.en} {f.label.hi && <span className="hi" lang="hi">{f.label.hi}</span>} {!f.required && <span className="opt">(optional)</span>}</span>
          {control}
          <Msg id={`${id}-msg`} text={words} />
        </div>
      );
    }
  } else if (f.type === "date") {
    control = <input {...common} className="input" type="date" value={value} max={new Date().toISOString().slice(0, 10)} onChange={(e) => onChange(e.target.value)} />;
  } else if (f.type === "number") {
    control = <input {...common} className="input" inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value)} />;
  } else {
    control = <input {...common} className="input" value={value} placeholder={"placeholder" in f ? f.placeholder : f.type === "location" ? "Your area or town" : undefined}
      maxLength={f.type === "text" ? f.max : 80} autoComplete={f.type === "location" ? "address-level2" : "off"} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <div className="stack">
      {label}
      {control}
      <Msg id={`${id}-msg`} text={words} />
    </div>
  );
}
