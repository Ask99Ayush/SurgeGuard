"use client";

import "./globals.css";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body className="grid min-h-dvh place-items-center bg-background p-6 text-foreground">
        <div className="max-w-sm text-center">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="mt-2 text-sm text-muted">An unexpected error stopped this page from rendering.</p>
          <button
            type="button"
            onClick={reset}
            className="mt-5 h-10 rounded-[10px] bg-foreground px-4 text-sm font-medium text-background"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
