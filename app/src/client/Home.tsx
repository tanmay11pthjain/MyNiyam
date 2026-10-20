"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, say } from "./api";
import { Button, Frame } from "./ui";
import type { Me } from "@/lib/api-types";

/** Home after joining. The niyam log itself is the next piece of work; this proves the person landed. */
export function Home() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [err, setErr] = useState<{ en: string; hi: string } | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    void api<Me>("/api/me").then((r) => {
      if (r.ok) {
        const p = r.data.profiles.find((x) => x.id === r.data.activeProfileId);
        if (!p || !p.setupDone || p.missing?.length) router.replace("/who"); // new required questions are asked first
        else setMe(r.data);
      } else if (r.err.error === "unauthorized") router.replace("/");
      else setErr(say(r.err));
    });
  }, [router]);

  if (err) return <Frame><div className="screen"><div className="banner err">{err.en}</div></div></Frame>;
  if (!me) return <Frame><div className="screen" aria-busy="true"><div className="skel" style={{ minHeight: 200 }} /></div></Frame>;

  const p = me.profiles.find((x) => x.id === me.activeProfileId)!;
  const cls = me.classes.find((c) => c.id === p.classId);
  return (
    <Frame>
      <main className="screen center">
        <svg className="welcome-lamp" viewBox="0 0 96 96" aria-hidden="true">
          <path className="flame" d="M48 10c9 10.5 12 17.6 12 24.8A12 12 0 0 1 48 47a12 12 0 0 1-12-12.2C36 27.6 39 20.5 48 10z" />
          <path className="base" d="M10 56h76c-2.4 14.4-17.6 24-38 24S12.4 70.4 10 56z" />
        </svg>
        <h1>Jai Jinendra, {p.name}</h1>
        <p className="hi" lang="hi">जय जिनेन्द्र</p>
        <p className="lead">You&apos;re in {me.sangh.name}{cls ? `, ${cls.name}` : ""}.</p>
        <div className="card mt-6" style={{ textAlign: "left" }}>
          <p><b>Your niyams will show up here.</b></p>
          <p className="hint mt-4">Your pathshala is setting them up. <span lang="hi">आपकी पाठशाला नियम तैयार कर रही है।</span></p>
        </div>
        <div className="stack push">
          <Button kind="secondary" onClick={() => router.push("/who")}>Switch person</Button>
          <Button kind="quiet" busy={leaving} onClick={async () => { setLeaving(true); await api("/api/session/logout", { body: {} }); router.replace("/"); }}>Log out</Button>
        </div>
      </main>
    </Frame>
  );
}
