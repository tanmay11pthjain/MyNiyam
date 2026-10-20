import type { Metadata } from "next";
import { LoginFlow } from "@/client/JoinFlow";

export const metadata: Metadata = { title: "Log in · MyNiyam" };

export default function Page() {
  return <LoginFlow />;
}
