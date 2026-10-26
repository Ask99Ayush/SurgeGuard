/**
 * Dynamic service URL resolvers.
 *
 * Ensures all dashboard, landing page, and external integration links
 * reliably resolve to the correct reachable host (e.g. AWS cluster IP or domain)
 * rather than unreachable localhost or non-existent relative routes.
 */

const DEFAULT_AWS_IP = "3.109.184.177";

export function resolveServiceUrl(
  configuredUrl: string | null | undefined,
  defaultPort: number,
  fallbackPortIfLocalhost?: number,
): string {
  // If running in browser:
  if (typeof window !== "undefined") {
    const activeHost = window.location.hostname;
    const isLocalClient = activeHost === "localhost" || activeHost === "127.0.0.1";

    if (configuredUrl && configuredUrl.trim()) {
      try {
        const parsed = new URL(configuredUrl);
        const urlIsLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";

        // If configured URL is localhost but the user is accessing remotely,
        // substitute the active client host and port.
        if (urlIsLocal && !isLocalClient) {
          parsed.hostname = activeHost;
          if (fallbackPortIfLocalhost) {
            parsed.port = String(fallbackPortIfLocalhost);
          }
          return parsed.toString().replace(/\/$/, "");
        }
        return configuredUrl.replace(/\/$/, "");
      } catch {
        // Fall through to window origin resolution
      }
    }

    // Default to active window hostname with specified port
    const protocol = window.location.protocol;
    return `${protocol}//${activeHost}:${defaultPort}`;
  }

  // Running on server (SSR):
  if (configuredUrl && configuredUrl.trim()) {
    return configuredUrl.replace(/\/$/, "");
  }
  return `http://${DEFAULT_AWS_IP}:${defaultPort}`;
}

export function getProtectedSiteUrl(configured?: string | null): string {
  if (typeof window !== "undefined" && window.location.hostname.includes("duckdns.org")) {
    return "https://surgeguard-protected.duckdns.org";
  }
  return resolveServiceUrl(configured, 8088, 8088);
}

export function getDirectOriginUrl(configured?: string | null): string {
  if (typeof window !== "undefined" && window.location.hostname.includes("duckdns.org")) {
    return "https://surgeguard-direct.duckdns.org";
  }
  return resolveServiceUrl(configured, 8081, 8081);
}

export function getGrafanaBaseUrl(configured?: string | null): string {
  if (typeof window !== "undefined" && window.location.hostname.includes("duckdns.org")) {
    return "https://surgeguard-monitor.duckdns.org";
  }
  return resolveServiceUrl(configured, 3001, 3001);
}

export function getGrafanaDashboardUrl(boardId: string, configured?: string | null): string {
  const base = getGrafanaBaseUrl(configured);
  return `${base}/d/${boardId}`;
}
