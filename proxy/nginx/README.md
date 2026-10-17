# Nginx edge

Image: `nginxinc/nginx-unprivileged:1.28.0-alpine` (uid 101). Configuration is rendered at container start:

| File | Rendered by | Output |
|---|---|---|
| `render-upstreams.sh` | `/docker-entrypoint.d/15-…` | `conf.d/sg-upstreams.conf` from `BACKEND_URLS`, `NGINX_API_UPSTREAM`, `NGINX_FRONTEND_UPSTREAM` |
| `templates/sg-site.conf.template` | the image's envsubst step | `conf.d/sg-site.conf` (only variables present in the environment are substituted) |

Servers:

- **8080 protected**: `auth_request` gate in front of the origin pool, waiting room routes, rate limits, static-only cache, fail-closed pages in `html/`.
- **8081 unprotected**: same backends, no SurgeGuard. Local comparison only.
- **8090 internal**: `stub_status` for the exporter and `/healthz`. Not published.

Health-aware routing is passive (`max_fails=2 fail_timeout=10s`); Nginx OSS has no active checks.
Active checks are done by the admission worker and affect admission, not routing. See
`docs/architecture.md` for the full behaviour table and `proxy/tests/` for the tests (`make test-proxy`).
