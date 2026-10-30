/**
 * SurgeGuard Smoke Test (scripts/smoke.js)
 *
 * Verifies reachability, HTTP status codes, and baseline behavior
 * of both Guarded and Unguarded endpoints using minimal VUs.
 *
 * Exit code is non-zero if any check fails (k6 threshold enforced).
 */

import http from "k6/http";
import { check, sleep } from "k6";
import {
  GUARDED_URL,
  UNGUARDED_URL,
  INSECURE_TLS,
  REQUEST_TIMEOUT,
  enterAndPassQueue,
  guardedOk,
  guardedErrors,
  guardedDuration,
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
  let allPassed = true;

  console.log(`[SMOKE] Testing UNGUARDED direct origin at: ${UNGUARDED_URL}`);

  // 1. Unguarded Health Probe
  const unprotHealth = http.get(`${UNGUARDED_URL}/health`, { timeout: REQUEST_TIMEOUT });
  const healthChecks = check(unprotHealth, {
    "unguarded /health returns 200 OK": (r) => r.status === 200,
    "unguarded /health json status is ok": (r) => {
      try {
        return r.json().status === "ok";
      } catch (_) {
        return false;
      }
    },
  });
  if (!healthChecks) {
    allPassed = false;
    console.error(`[SMOKE FAIL] Unguarded /health check failed. Status: ${unprotHealth.status}`);
  }

  // 2. Unguarded Portal Home Page
  const unprotHome = http.get(`${UNGUARDED_URL}/`, { timeout: REQUEST_TIMEOUT });
  const homeChecks = check(unprotHome, {
    "unguarded portal returns 200 OK": (r) => r.status === 200,
    "unguarded portal contains exam results text": (r) =>
      r.body && (r.body.includes("Examination Results") || r.body.includes("Senior Secondary")),
  });
  if (!homeChecks) {
    allPassed = false;
    console.error(`[SMOKE FAIL] Unguarded homepage check failed. Status: ${unprotHome.status}`);
  }

  sleep(0.5);

  console.log(`[SMOKE] Testing GUARDED gateway at: ${GUARDED_URL}`);

  // Clear cookie jar before initial unadmitted visitor check
  const jar = http.cookieJar();
  jar.clear(GUARDED_URL);

  // 3. Guarded Gateway Token Gate Enforcement
  // Requests without an admission token MUST be intercepted (302 redirect)
  const protUnauth = http.get(`${GUARDED_URL}/`, { redirects: 0, timeout: REQUEST_TIMEOUT });
  const gateChecks = check(protUnauth, {
    "guarded gate redirects unauthorized visitor": (r) =>
      r.status === 302 || (r.status === 301 && r.headers.Location && r.headers.Location.startsWith("https://")),
  });
  if (!gateChecks) {
    allPassed = false;
    console.error(`[SMOKE FAIL] Guarded gate check failed. Status: ${protUnauth.status}, expected 302`);
  }

  // 4. Guarded Queue Join
  const joinRes = http.post(`${GUARDED_URL}/api/v1/queue/join`, null, { timeout: REQUEST_TIMEOUT });
  const joinChecks = check(joinRes, {
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
  if (!joinChecks) {
    allPassed = false;
    console.error(`[SMOKE FAIL] Queue join failed. Status: ${joinRes.status}`);
  }

  // 5. Guarded Queue Status Heartbeat (Cookie preserved by k6 cookie jar)
  const statusRes = http.get(`${GUARDED_URL}/api/v1/queue/status`, { timeout: REQUEST_TIMEOUT });
  const statusChecks = check(statusRes, {
    "queue status heartbeat returns 200 OK": (r) => r.status === 200,
  });
  if (!statusChecks) {
    allPassed = false;
    console.error(`[SMOKE FAIL] Queue status check failed. Status: ${statusRes.status}`);
  }

  // 6. Attempt admission and verify admitted access (best effort, no wait loop)
  // If already admitted from step 4, try to access the protected page
  if (joinRes.status === 200) {
    let body = {};
    try { body = joinRes.json(); } catch (_) {}
    if (body.state === "admitted") {
      const admittedStart = Date.now();
      const admittedPage = http.get(`${GUARDED_URL}/`, {
        timeout: REQUEST_TIMEOUT,
        tags: { stage: "smoke_admitted_access" },
      });
      const admittedMs = Date.now() - admittedStart;
      const admittedChecks = check(admittedPage, {
        "admitted visitor can access protected origin (200 OK)": (r) => r.status === 200,
      });
      if (admittedChecks) {
        guardedOk.add(1);
        guardedDuration.add(admittedMs);
        guardedErrors.add(0);
      } else {
        guardedErrors.add(1);
        console.warn(`[SMOKE] Admitted page access returned ${admittedPage.status} (expected 200 after token admission).`);
      }
    } else {
      console.log(`[SMOKE] Visitor is in 'waiting' state — skipping admitted-access check (queue poll would exceed smoke timeout).`);
    }
  }

  if (allPassed) {
    console.log("[SMOKE] ✓ All verification checks passed for both endpoints.");
  } else {
    console.error("[SMOKE] ✗ One or more checks FAILED — see errors above.");
  }
}
