import { Suspense } from "react";
import { NiyamsPage } from "@/client/admin/NiyamsPage";

// Session-gated, loads in the browser: not an instant navigation (see layout.tsx).
export const instant = false;

export default function Page() {
  return (
    <Suspense fallback={null}>
      <NiyamsPage />
    </Suspense>
  );
}
