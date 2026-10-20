import type { Metadata } from "next";
import { AdminLogin } from "@/client/admin/AdminLogin";

export const metadata: Metadata = { title: "Admin log in · MyNiyam" };

export default function Page() {
  return <AdminLogin />;
}
