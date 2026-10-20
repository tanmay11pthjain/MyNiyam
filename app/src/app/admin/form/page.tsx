import { FormBuilder } from "@/client/admin/FormBuilder";

// Session-gated, loads in the browser: not an instant navigation (see layout.tsx).
export const instant = false;

export default function Page() {
  return <FormBuilder />;
}
