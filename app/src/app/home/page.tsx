import type { Metadata } from "next";
import { Home } from "@/client/Home";

export const metadata: Metadata = { title: "MyNiyam" };

export default function Page() {
  return <Home />;
}
