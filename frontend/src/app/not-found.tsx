import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";

export default function NotFound() {
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-4">
      <div className="text-center">
        <Wordmark className="justify-center" />
        <h1 className="mt-8 text-2xl font-semibold tracking-[-0.02em]">Page not found</h1>
        <p className="mt-2 text-sm text-muted">That page doesn&apos;t exist.</p>
        <Link href="/" className="mt-6 inline-flex h-10 items-center rounded-[10px] border border-border bg-surface-elevated px-4 text-sm">
          Back home
        </Link>
      </div>
    </main>
  );
}
