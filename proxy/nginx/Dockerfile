# syntax=docker/dockerfile:1
# Unprivileged image: runs as uid 101, listens on ports >1024. 1.28 includes `resolve` in upstreams.
FROM nginxinc/nginx-unprivileged:1.28.0-alpine
USER root
RUN apk add --no-cache openssl && \
    mkdir -p /etc/nginx/certs && \
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
      -keyout /etc/nginx/certs/surgeguard.key \
      -out /etc/nginx/certs/surgeguard.crt \
      -subj "/CN=surgeguard-innotech.duckdns.org" \
      -addext "subjectAltName=DNS:surgeguard-innotech.duckdns.org,DNS:surgeguard-protected.duckdns.org,DNS:surgeguard-direct.duckdns.org,DNS:surgeguard-admin.duckdns.org,DNS:surgeguard-monitor.duckdns.org,DNS:localhost,IP:127.0.0.1" && \
    chmod 644 /etc/nginx/certs/surgeguard.crt && \
    chmod 640 /etc/nginx/certs/surgeguard.key && \
    chown -R 101:101 /etc/nginx/certs
USER 101

COPY nginx.conf /etc/nginx/nginx.conf
COPY snippets /etc/nginx/snippets
COPY templates /etc/nginx/templates
COPY html /usr/share/nginx/html/sg
COPY --chmod=755 render-upstreams.sh /docker-entrypoint.d/15-render-upstreams.sh
EXPOSE 8080 8443 8081 8090

