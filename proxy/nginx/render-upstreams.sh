#!/bin/sh
# Render upstream blocks from environment so no backend address is hardcoded in config.
#   BACKEND_URLS          comma-separated origin URLs, e.g. http://demo-1:8000,http://demo-2:8000
#   NGINX_API_UPSTREAM    host:port of the SurgeGuard API
#   NGINX_FRONTEND_UPSTREAM host:port of the Next.js frontend
set -eu

out=/etc/nginx/conf.d/sg-upstreams.conf
: "${BACKEND_URLS:?BACKEND_URLS is required}"
: "${NGINX_API_UPSTREAM:?NGINX_API_UPSTREAM is required}"
: "${NGINX_FRONTEND_UPSTREAM:?NGINX_FRONTEND_UPSTREAM is required}"

servers=""
old_ifs=$IFS
IFS=','
for url in $BACKEND_URLS; do
  hostport=$(printf '%s' "$url" | sed -e 's#^[a-zA-Z]*://##' -e 's#/.*$##' | tr -d ' ')
  case "$hostport" in
    *[!A-Za-z0-9.:_-]*|"") echo "render-upstreams: invalid backend '$url'" >&2; exit 1 ;;
  esac
  # resolve: re-resolve Docker DNS at runtime (nginx >= 1.27.3), so a stopped container does not
  # break startup. Passive health: max_fails/fail_timeout take a failing instance out of rotation.
  servers="${servers}    server ${hostport} resolve max_fails=2 fail_timeout=10s;
"
done
IFS=$old_ifs

cat > "$out" <<EOF
# Generated at container start by render-upstreams.sh. Do not edit.
resolver 127.0.0.11 valid=10s ipv6=off;

upstream origin_pool {
    zone origin_pool 128k;
${servers}    keepalive 32;
}

# Same backends for the unprotected comparison path (separate passive-health state).
upstream origin_direct {
    zone origin_direct 128k;
${servers}    keepalive 32;
}

upstream sg_api {
    zone sg_api 64k;
    server ${NGINX_API_UPSTREAM} resolve max_fails=0;
    keepalive 32;
}

upstream sg_frontend {
    zone sg_frontend 64k;
    server ${NGINX_FRONTEND_UPSTREAM} resolve max_fails=0;
    keepalive 16;
}

upstream sg_grafana {
    zone sg_grafana 64k;
    server grafana:3000 resolve max_fails=0;
    keepalive 16;
}
EOF
echo "render-upstreams: wrote $out"
