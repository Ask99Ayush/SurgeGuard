"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { BarChart2, Clock, Command, ExternalLink, Layout, Monitor, MonitorPlay, Search, Server, Settings, Users } from "lucide-react";
import { cn } from "@/components/ui/primitives";
import { NAV } from "@/components/admin/AdminShell";
import { getGrafanaBaseUrl } from "@/lib/urls";
import { usePolling } from "@/hooks/usePolling";

interface CommandItem {
  id: string;
  label: string;
  icon: React.ElementType;
  action: () => void;
  group: string;
  keywords?: string;
}

export function CommandPalette({ grafanaUrl }: { grafanaUrl?: string | null }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const config = usePolling<{ grafana_url?: string }>("/api/admin/config", 60_000);
  const gUrl = getGrafanaBaseUrl(grafanaUrl ?? config.data?.grafana_url);

  const NAV_ICONS: Record<string, React.ElementType> = {
    "/dashboard": Layout,
    "/queue": Users,
    "/backends": Server,
    "/monitoring": Monitor,
    "/settings": Settings,
  };

  function close() {
    setOpen(false);
    setQuery("");
    setSelected(0);
  }

  const allCommands: CommandItem[] = [
    ...NAV.map(({ href, label }) => ({
      id: `nav-${href}`,
      label: `Go to ${label}`,
      icon: NAV_ICONS[href] ?? Layout,
      action: () => { router.push(href); close(); },
      group: "Navigation",
    })),
    {
      id: "live-projector",
      label: "Launch Live Projector View",
      icon: MonitorPlay,
      action: () => { router.push("/live"); close(); },
      group: "Navigation",
      keywords: "live projector wallboard kiosk",
    },
    {
      id: "waiting-room",
      label: "Preview Visitor Waiting Room",
      icon: Clock,
      action: () => { window.open("/waiting-room", "_blank", "noreferrer"); close(); },
      group: "Navigation",
      keywords: "visitor waiting room client queue ticket",
    },
    ...(gUrl
      ? [
          {
            id: "grafana",
            label: "Open Grafana Dashboard",
            icon: BarChart2,
            action: () => { window.open(gUrl, "_blank", "noreferrer"); close(); },
            group: "External",
            keywords: "metrics monitoring grafana",
          },
        ]
      : []),
    {
      id: "visitor-search",
      label: "Search visitor in Queue",
      icon: Search,
      action: () => { router.push("/queue"); close(); },
      group: "Actions",
      keywords: "visitor id search queue",
    },
  ];

  const filtered = query.trim()
    ? allCommands.filter(
        (c) =>
          c.label.toLowerCase().includes(query.toLowerCase()) ||
          c.keywords?.includes(query.toLowerCase()),
      )
    : allCommands;

  // Global keyboard shortcut
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        setQuery("");
        setSelected(0);
      }
      if (e.key === "Escape" && open) close();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => setSelected(0), [query]);

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); setSelected((s) => Math.min(s + 1, filtered.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); }
    if (e.key === "Enter" && filtered[selected]) filtered[selected].action();
  }

  if (!open) {
    return (
      <button
        type="button"
        aria-label="Open command palette (Ctrl+K)"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-30 hidden items-center gap-2 rounded-2xl border border-border bg-surface px-3 py-2 text-xs text-muted shadow-[var(--shadow-pop)] transition-colors hover:border-border-strong hover:text-foreground sm:flex"
      >
        <Command className="size-3.5" aria-hidden />
        <span>Command palette</span>
        <kbd className="keycap ml-1 px-1.5 py-0.5 text-[10px]">⌘K</kbd>
      </button>
    );
  }

  // Group commands
  const groups = Array.from(new Set(filtered.map((c) => c.group)));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close command palette"
        className="absolute inset-0 bg-background/60 backdrop-blur-sm"
        onClick={close}
      />
      <div
        role="dialog"
        aria-label="Command palette"
        aria-modal="true"
        className="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-pop)]"
      >
        {/* Search input */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search className="size-4 text-muted" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={true}
            aria-controls="cmd-listbox"
            aria-autocomplete="list"
            aria-activedescendant={filtered[selected] ? `cmd-${filtered[selected].id}` : undefined}
            placeholder="Search pages, actions…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted focus:outline-none"
          />
          <kbd className="keycap px-1.5 py-0.5 text-[10px]">Esc</kbd>
        </div>

        {/* Results */}
        <ul id="cmd-listbox" role="listbox" className="max-h-72 overflow-y-auto py-1">
          {filtered.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-muted">No commands found</li>
          )}
          {groups.map((group) => (
            <li key={group}>
              <p className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-subtle">
                {group}
              </p>
              <ul>
                {filtered
                  .filter((c) => c.group === group)
                  .map((cmd) => {
                    const idx = filtered.indexOf(cmd);
                    const Icon = cmd.icon;
                    return (
                      <li
                        key={cmd.id}
                        id={`cmd-${cmd.id}`}
                        role="option"
                        aria-selected={idx === selected}
                      >
                        <button
                          type="button"
                          onClick={cmd.action}
                          onMouseEnter={() => setSelected(idx)}
                          className={cn(
                            "flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors",
                            idx === selected ? "bg-surface-elevated text-foreground" : "text-muted hover:text-foreground",
                          )}
                        >
                          <Icon className="size-4 shrink-0" aria-hidden />
                          {cmd.label}
                          {cmd.group === "External" && (
                            <ExternalLink className="ml-auto size-3 text-subtle" aria-hidden />
                          )}
                        </button>
                      </li>
                    );
                  })}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
