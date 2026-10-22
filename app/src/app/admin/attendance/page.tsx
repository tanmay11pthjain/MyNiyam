import { AttendancePage } from "@/client/admin/AttendancePage";

// Session-gated, loads in the browser: not an instant navigation (see layout.tsx).
export const instant = false;

export default function Page() {
  return <AttendancePage />;
}
