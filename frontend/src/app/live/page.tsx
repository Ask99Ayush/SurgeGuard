import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LiveView } from "@/components/admin/LiveView";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

export const metadata: Metadata = { title: "Live" };
export const dynamic = "force-dynamic";

/** Projector view: admin login required (also enforced by middleware), no navigation chrome. */
export default async function LivePage() {
  const store = await cookies();
  const session = await verifySessionToken(store.get(SESSION_COOKIE)?.value, process.env.SESSION_SECRET);
  if (!session) redirect("/login?next=/live");
  return <LiveView />;
}
