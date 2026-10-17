import type { Metadata } from "next";
import { QueueView } from "@/components/admin/QueueView";

export const metadata: Metadata = { title: "Queue" };

export default function QueuePage() {
  return <QueueView />;
}
