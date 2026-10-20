import type { Metadata } from "next";
import { AdminApp } from "@/client/admin/AdminApp";
import "./admin.css";

export const metadata: Metadata = { title: "Admin · MyNiyam", robots: { index: false, follow: false } };

export default function Layout({ children }: LayoutProps<"/admin">) {
  return <AdminApp>{children}</AdminApp>;
}
