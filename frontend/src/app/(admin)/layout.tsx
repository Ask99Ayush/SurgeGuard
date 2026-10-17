import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  const session = await verifySessionToken(store.get(SESSION_COOKIE)?.value, process.env.SESSION_SECRET);
  if (!session) redirect("/login");
  return (
    <AdminShell username={session.username} role={session.role}>
      {children}
    </AdminShell>
  );
}
