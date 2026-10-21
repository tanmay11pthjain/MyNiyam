"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, say } from "./api";
import { Icon } from "./admin/icons";
import { HistoryTab } from "./HistoryTab";
import { TodayTab } from "./TodayTab";
import { Button, Frame, goToLanding } from "./ui";
import type { Me, Profile } from "@/lib/api-types";

type Tab = "today" | "history" | "profile";

const Calendar = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
);

const TABS: { id: Tab; label: string; icon: () => React.ReactNode }[] = [
  { id: "today", label: "Today", icon: Icon.niyam },
  { id: "history", label: "History", icon: Calendar },
  { id: "profile", label: "Profile", icon: Icon.people },
];

/** The app after joining: Today, History and Profile, with the person's name always one tap from switching. */
export function Home() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [err, setErr] = useState<{ en: string; hi: string } | null>(null);
  const [tab, setTab] = useState<Tab>("today");

  useEffect(() => {
    void api<Me>("/api/me").then((r) => {
      if (r.ok) {
        const p = r.data.profiles.find((x) => x.id === r.data.activeProfileId);
        if (!p || !p.setupDone || p.missing?.length) router.replace("/who"); // new required questions are asked first
        else setMe(r.data);
      } else if (r.err.error === "unauthorized") goToLanding();
      else setErr(say(r.err));
    });
  }, [router]);

  if (err) return <Frame><div className="screen"><div className="banner err">{err.en}</div></div></Frame>;
  if (!me) return <Frame><div className="screen" aria-busy="true"><div className="skel" style={{ minHeight: 200 }} /></div></Frame>;

  const p = me.profiles.find((x) => x.id === me.activeProfileId)!;
  const cls = me.classes.find((c) => c.id === p.classId);

  return (
    <Frame right={
      <Link href="/who" className="who-chip" aria-label={`${p.name}. Switch person`}>
        <span className="avatar kesar" aria-hidden="true">{p.name.charAt(0).toUpperCase()}</span>
        <span className="who-name">{p.name}</span>
      </Link>
    }>
      <main className="screen app-main">
        <div className="sangh-line">
          <p className="sangh-name">{me.sangh.name}</p>
          {cls && <p className="class-name">{cls.name}</p>}
        </div>
        {tab === "today" && <TodayTab />}
        {tab === "history" && <HistoryTab />}
        {tab === "profile" && <ProfileTab p={p} me={me} cls={cls?.name} />}
        <footer className="app-foot">
          Presented by Heer Sena · Developed by Tanmay Dhelariya · v{process.env.NEXT_PUBLIC_APP_VERSION} ({process.env.NEXT_PUBLIC_APP_COMMIT})
        </footer>
      </main>
      <nav className="tabbar" aria-label="Main">
        {TABS.map((t) => (
          <button key={t.id} type="button" aria-current={tab === t.id ? "page" : undefined} onClick={() => { setTab(t.id); window.scrollTo(0, 0); }}>
            <t.icon />{t.label}
          </button>
        ))}
      </nav>
    </Frame>
  );
}

function ProfileTab({ p, me, cls }: { p: Profile; me: Me; cls?: string }) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  return (
    <div className="stack-lg">
      <section className="card prof">
        <span className="avatar kesar big" aria-hidden="true">{p.name.charAt(0).toUpperCase()}</span>
        <h1>{p.name}</h1>
        <p className="hint">{p.relation === "self" ? "Myself" : "Child"}{cls ? ` · ${cls}` : ""}</p>
        <p className="hint">{me.sangh.name}, {me.sangh.city} · {me.phone}</p>
      </section>
      <div className="stack">
        <Link className="btn btn-secondary" href={`/who?edit=${p.id}`}>Edit my details</Link>
        <Button kind="secondary" onClick={() => router.push("/who")}>Switch person</Button>
        <Button kind="quiet" busy={leaving} onClick={async () => { setLeaving(true); await api("/api/session/logout", { body: {} }); goToLanding(); }}>Log out</Button>
      </div>
      <p className="hint center"><Link href="/privacy">Privacy</Link> · MyNiyam v{process.env.NEXT_PUBLIC_APP_VERSION} ({process.env.NEXT_PUBLIC_APP_COMMIT})</p>
    </div>
  );
}
