import type { Metadata } from "next";
import { MonitoringView } from "@/components/admin/MonitoringView";

export const metadata: Metadata = { title: "Monitoring" };

export default function MonitoringPage() {
  return <MonitoringView grafanaUrl={process.env.PUBLIC_GRAFANA_URL ?? null} />;
}
