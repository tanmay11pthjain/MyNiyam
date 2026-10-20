import type { Metadata } from "next";
import { WhoScreen } from "@/client/WhoScreen";

export const metadata: Metadata = { title: "Who is using MyNiyam?" };

export default function Page() {
  return <WhoScreen />;
}
