import type { Metadata } from "next";
import { DashboardView } from "@/components/admin/DashboardView";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  const siteUrl = process.env.PUBLIC_SITE_URL ?? null;
  const directUrl = process.env.PUBLIC_DIRECT_URL ?? null;
  const grafanaUrl = process.env.PUBLIC_GRAFANA_URL ?? null;

  return <DashboardView siteUrl={siteUrl} directUrl={directUrl} grafanaUrl={grafanaUrl} />;
}

