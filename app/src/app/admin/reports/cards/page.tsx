import { Suspense } from "react";
import { ReportCardsPage } from "@/client/admin/ReportCardsPage";

// Session-gated, loads in the browser: not an instant navigation (see layout.tsx).
export const instant = false;

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ReportCardsPage />
    </Suspense>
  );
}
