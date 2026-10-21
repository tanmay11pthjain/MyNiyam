import { Suspense } from "react";
import { MembersPage } from "@/client/admin/MembersPage";

// Session-gated, loads in the browser: not an instant navigation (see layout.tsx).
export const instant = false;

export default function Page() {
  return (
    <Suspense fallback={null}>
      <MembersPage />
    </Suspense>
  );
}
