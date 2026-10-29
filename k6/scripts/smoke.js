/**
 * SurgeGuard Smoke Test (scripts/smoke.js)
 *
 * Verifies reachability, HTTP status codes, and baseline behavior
 * of both Guarded and Unguarded endpoints using minimal VUs.
 */

import http from "k6/http";
import { check, sleep } from "k6";
import {
  GUARDED_URL,
  UNGUARDED_URL,
  INSECURE_TLS,
  REQUEST_TIMEOUT,
} from "../config/options.js";

export const options = {
  vus: 1,
  iterations: 1,
  insecureSkipTLSVerify: INSECURE_TLS,
  thresholds: {
    checks: ["rate == 1.0"], // All smoke assertions must pass
  },
};

export default function () {
  console.log(`[SMOKE] Testing UNGUARDED direct origin at: ${UNGUARDED_URL}`);

  // 1. Unguarded Health Probe
  const unprotHealth = http.get(`${UNGUARDED_URL}/health`, { timeout: REQUEST_TIMEOUT });
  check(unprotHealth, {
    "unguarded /health returns 200 OK": (r) => r.status === 200,
    "unguarded /health json status is ok": (r) => {
      try {
        return r.json().status === "ok";
      } catch (_) {
        return false;
      }
    },
  });

  // 2. Unguarded Portal Home Page
  const unprotHome = http.get(`${UNGUARDED_URL}/`, { timeout: REQUEST_TIMEOUT });
  check(unprotHome, {
    "unguarded portal returns 200 OK": (r) => r.status === 200,
    "unguarded portal contains exam results text": (r) =>
      r.body && (r.body.includes("Examination Results") || r.body.includes("Senior Secondary")),
  });

  sleep(0.5);

  console.log(`[SMOKE] Testing GUARDED gateway at: ${GUARDED_URL}`);

  // Clear cookie jar before initial unadmitted visitor check
  const jar = http.cookieJar();
  jar.clear(GUARDED_URL);

  // 3. Guarded Gateway Token Gate Enforcement
  // Requests without an admission token MUST be intercepted (302 redirect or 301 HTTPS upgrade)
  const protUnauth = http.get(`${GUARDED_URL}/`, { redirects: 0, timeout: REQUEST_TIMEOUT });
  check(protUnauth, {
    "guarded gate redirects unauthorized visitor": (r) =>
      r.status === 302 || (r.status === 301 && r.headers.Location && r.headers.Location.startsWith("https://")),
  });

  // 4. Guarded Queue Join
  const joinRes = http.post(`${GUARDED_URL}/api/v1/queue/join`, null, { timeout: REQUEST_TIMEOUT });
  check(joinRes, {
    "queue join returns 200 OK": (r) => r.status === 200,
    "queue join returns valid state": (r) => {
      try {
        const body = r.json();
        return body.state === "waiting" || body.state === "admitted";
      } catch (_) {
        return false;
      }
    },
  });

  // 5. Guarded Queue Status Heartbeat (Cookie preserved by k6 cookie jar)
  const statusRes = http.get(`${GUARDED_URL}/api/v1/queue/status`, { timeout: REQUEST_TIMEOUT });
  check(statusRes, {
    "queue status heartbeat returns 200 OK": (r) => r.status === 200,
  });

  console.log("[SMOKE] Verification completed successfully for both endpoints.");
}
