import { SetupHub } from "@/client/admin/SetupHub";

// Session-gated, loads in the browser: not an instant navigation (see layout.tsx).
export const instant = false;

export default function Page() {
  return <SetupHub />;
}
