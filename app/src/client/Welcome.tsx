"use client";
import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "./api";
import type { Me } from "@/lib/api-types";

/** First screen. Signed-in people go straight on; everyone else picks join or log in. */
export function Welcome() {
  const router = useRouter();
  useEffect(() => {
    void api<Me>("/api/me").then((r) => {
      if (!r.ok) return;
      const active = r.data.profiles.find((p) => p.id === r.data.activeProfileId);
      router.replace(active?.setupDone ? "/home" : "/who");
    });
  }, [router]);

  return (
    <div className="frame">
      <main className="welcome">
        <img className="mark day-only" src="/brand/mark.png" alt="" width={258} height={252} />
        <img className="mark night-only" src="/brand/mark-night.png" alt="" width={258} height={252} />
        <h1>Jai Jinendra</h1>
        <p className="hi" lang="hi">जय जिनेन्द्र</p>
        <p className="lead">Keep your daily niyams with your pathshala.</p>
        <div className="stack mt-6">
          <Link className="btn btn-primary" href="/join">Join your pathshala</Link>
          <Link className="btn btn-quiet" href="/login">Already joined? Log in</Link>
        </div>
      </main>
    </div>
  );
}
