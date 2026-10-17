import type { Metadata } from "next";
import { SettingsView } from "@/components/admin/SettingsView";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return <SettingsView grafanaUrl={process.env.PUBLIC_GRAFANA_URL ?? null} siteUrl={process.env.PUBLIC_SITE_URL ?? null} />;
}
