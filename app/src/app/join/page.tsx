import type { Metadata } from "next";
import { Suspense } from "react";
import { JoinFlow } from "@/client/JoinFlow";

export const metadata: Metadata = { title: "Join your pathshala · MyNiyam" };

// /join, /join?code=HEER01 and the QR link /j/HEER01 (redirected here by next.config.ts).
export default function Page() {
  return (
    <Suspense fallback={<div className="frame" />}>
      <JoinFlow />
    </Suspense>
  );
}
