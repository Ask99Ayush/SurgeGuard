import type { Metadata } from "next";
import { BackendsView } from "@/components/admin/BackendsView";

export const metadata: Metadata = { title: "Backends" };

export default function BackendsPage() {
  return <BackendsView />;
}
