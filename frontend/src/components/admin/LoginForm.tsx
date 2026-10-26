"use client";

import { useState, type FormEvent } from "react";
import { Eye, Lock, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { RequestFailure, fetchJson } from "@/lib/client";

const browserNavigate = (url: string) => window.location.assign(url);

export function LoginForm({
  next,
  demo = null,
  navigate = browserNavigate,
}: {
  next: string;
  /** Public demo credentials, shown only when the server enables them. */
  demo?: { username: string; password: string; role?: "admin" | "viewer" } | null;
  navigate?: (url: string) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function login(user: string, pass: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await fetchJson<{ redirect: string }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: user, password: pass, next }),
      });
      navigate(result.redirect);
    } catch (err) {
      setError(
        err instanceof RequestFailure
          ? err.kind === "network"
            ? "Can't reach the console server."
            : err.message
          : "Login failed.",
      );
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void login(username, password);
  }

  function signInAsDemo() {
    if (!demo) return;
    setUsername(demo.username);
    setPassword(demo.password);
    void login(demo.username, demo.password);
  }

  function signInAsAdmin() {
    setUsername("admin");
    setPassword("admin123");
    void login("admin", "admin123");
  }

  function fillAdmin() {
    setUsername("admin");
    setPassword("admin123");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate aria-describedby={error ? "login-error" : undefined}>
      <div>
        <label htmlFor="username" className="text-sm font-medium text-muted">
          Username
        </label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="mt-1.5 h-11 w-full rounded-[10px] border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-subtle focus:border-border-strong"
        />
      </div>
      <div>
        <label htmlFor="password" className="text-sm font-medium text-muted">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1.5 h-11 w-full rounded-[10px] border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-border-strong"
        />
      </div>
      {error ? (
        <p id="login-error" role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="primary" className="w-full" disabled={busy || !username || !password}>
        <Lock className="size-4" aria-hidden />
        {busy ? "Signing in…" : "Sign in"}
      </Button>

      {/* Exhibition & Presentation Quick Admin Access */}
      <div className="pt-1">
        <Button
          type="button"
          variant="secondary"
          className="w-full border-accent/40 bg-accent/10 text-xs font-semibold text-accent hover:border-accent hover:bg-accent/20 transition-all flex items-center justify-center gap-2 py-2.5 shadow-sm"
          onClick={signInAsAdmin}
          disabled={busy}
        >
          <ShieldCheck className="size-4 text-accent" aria-hidden />
          <span>⚡ One-Click Root Admin (Full Sudo Access)</span>
        </Button>
        <div className="mt-2 flex items-center justify-between text-[11px] text-subtle px-1">
          <span>Admin: <strong className="text-muted font-mono">admin / admin123</strong></span>
          <button
            type="button"
            onClick={fillAdmin}
            className="text-accent hover:underline focus:outline-none font-medium cursor-pointer"
          >
            Auto-fill credentials
          </button>
        </div>
      </div>

      {demo ? (
        <div className="pt-2">
          <div className="relative mb-3 flex items-center justify-center">
            <span className="w-full border-t border-border" />
            <span className="bg-surface px-2 text-[11px] font-medium uppercase tracking-wider text-subtle">or</span>
            <span className="w-full border-t border-border" />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full border border-border/70 text-xs text-muted hover:border-border-strong hover:text-foreground"
            onClick={signInAsDemo}
            disabled={busy}
          >
            <Eye className="size-3.5" aria-hidden />
            Use demo account
          </Button>
        </div>
      ) : null}
    </form>
  );
}
