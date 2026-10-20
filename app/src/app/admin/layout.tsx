import type { Metadata } from "next";
import { AdminApp } from "@/client/admin/AdminApp";
import "./admin.css";

// Every admin page waits for the admin session and loads its data in the browser, so navigations
// here are not expected to be instant; opt the whole area out of instant-navigation validation.
export const instant = false;

export const metadata: Metadata = { title: "Admin · MyNiyam", robots: { index: false, follow: false } };

export default function Layout({ children }: LayoutProps<"/admin">) {
  return <AdminApp>{children}</AdminApp>;
}
