"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, say } from "./api";
import { shrinkImage, upload } from "./images";
import { JoinForm, type JoinValues } from "./JoinFields";
import { Button, Chevron, Frame, Msg, Title } from "./ui";
import type { ApiError, Me, Profile } from "@/lib/api-types";

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
      // Runs again whenever the screen is shown (Next keeps hidden routes alive), so start fresh.
      setView(r.data.profiles.length === 0 ? { name: "add" } : { name: "pick" });
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
        <PickList profiles={me.profiles} className={className} onPicked={(p) => (p.setupDone && !p.missing?.length ? router.push("/home") : setView({ name: "setup", profile: p }))} />
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
  const [values, setValues] = useState<JoinValues>({
    classId: profile.classId,
    photoUrl: profile.photoUrl ?? null,
    answers: Object.fromEntries(Object.entries(profile.answers ?? {}).map(([k, v]) => [k, String(v)])),
  });
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Words | null>(null);
  const catchUp = profile.setupDone && (profile.missing?.length ?? 0) > 0;
  // A catch-up visit asks only the new questions; everything else is already answered and kept.
  const fields = catchUp ? me.formFields.filter((f) => profile.missing!.includes(f.key)) : me.formFields;

  async function finish() {
    const missing: Record<string, string> = {};
    for (const f of fields) {
      if (!f.required) continue;
      const empty = f.type === "class" ? !values.classId : f.type === "photo" ? !values.photoUrl : !values.answers[f.key]?.trim();
      if (empty) missing[f.key] = "required";
    }
    if (Object.keys(missing).length) { setFieldErrs(missing); setErr(say({ error: "invalid_answers" })); return; }
    setBusy(true); setErr(null); setFieldErrs({});
    const r = await api<{ profile: Profile }>(`/api/profiles/${profile.id}`, { method: "PATCH", body: { classId: values.classId, answers: values.answers } });
    setBusy(false);
    if (r.ok) onDone();
    else {
      const e = r.err as ApiError;
      if (e.fields) setFieldErrs(e.fields);
      if (e.error === "invalid_class") setFieldErrs({ ...fieldErrs, class: "required" });
      setErr(say(r.err));
    }
  }

  async function uploadPhoto(file: File): Promise<boolean> {
    try {
      const r = await upload<{ photoUrl: string }>(`/api/profiles/${profile.id}/photo`, await shrinkImage(file, 512));
      if (r.ok) { setValues((v) => ({ ...v, photoUrl: r.data.photoUrl })); setFieldErrs((e) => ({ ...e, photo: "" })); return true; }
      setErr(say(r.err));
    } catch {
      setErr({ en: "That file isn't a picture we can read. Try another photo.", hi: "यह फ़ोटो नहीं खुल रही। दूसरी फ़ोटो चुनें।" });
    }
    return false;
  }

  const self = profile.relation === "self";
  return (
    <div className="screen">
      {catchUp ? (
        <Title en="A few new questions" hi="कुछ नए सवाल" lead={`${me.sangh.name} added questions. Please answer them${self ? "" : ` for ${profile.name}`} to carry on.`} />
      ) : (
        <Title en={self ? "A little about you" : `A little about ${profile.name}`} hi="थोड़ी जानकारी" lead={`What ${me.sangh.name} asks everyone who joins.`} />
      )}
      <div className="mt-5">
        {fields.length > 0 ? (
          <JoinForm fields={fields} classes={me.classes} values={values} errors={fieldErrs} onPhoto={uploadPhoto}
            onChange={(v, key) => { setValues(v); setFieldErrs({ ...fieldErrs, [key]: "" }); setErr(null); }} />
        ) : (
          <p className="lead">Nothing more to fill in.</p>
        )}
      </div>

      <div className="stack push">
        <Msg text={err} />
        <Button busy={busy} onClick={() => void finish()}>{busy ? "Saving…" : catchUp ? "Save and carry on" : "Finish and open MyNiyam"}</Button>
      </div>
    </div>
  );
}
