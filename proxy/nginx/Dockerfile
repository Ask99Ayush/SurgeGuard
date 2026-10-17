# syntax=docker/dockerfile:1
# Unprivileged image: runs as uid 101, listens on ports >1024. 1.28 includes `resolve` in upstreams.
FROM nginxinc/nginx-unprivileged:1.28.0-alpine
COPY nginx.conf /etc/nginx/nginx.conf
COPY snippets /etc/nginx/snippets
COPY templates /etc/nginx/templates
COPY html /usr/share/nginx/html/sg
COPY --chmod=755 render-upstreams.sh /docker-entrypoint.d/15-render-upstreams.sh
EXPOSE 8080 8081 8090
