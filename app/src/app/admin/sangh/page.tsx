import { SanghPage } from "@/client/admin/SanghPage";

// Session-gated, loads in the browser: not an instant navigation (see layout.tsx).
export const instant = false;

export default function Page() {
  return <SanghPage />;
}
