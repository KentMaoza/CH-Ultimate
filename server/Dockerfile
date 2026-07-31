FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json server/package.json
RUN npm ci --workspace @ch-ultimate/core --include-workspace-root=false

COPY server server
RUN npm --workspace @ch-ultimate/core run build \
    && npm prune --omit=dev --workspace @ch-ultimate/core --include-workspace-root=false

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV NODE_OPTIONS=--max-old-space-size=160

WORKDIR /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/server/package.json ./package.json
COPY --from=build --chown=node:node /app/server/dist ./dist
COPY --from=build --chown=node:node /app/server/migrations ./migrations
COPY server/scripts/container-entrypoint.sh /usr/local/bin/ch-core-container-entrypoint
RUN chmod 0555 /usr/local/bin/ch-core-container-entrypoint

USER node
ENTRYPOINT ["/usr/local/bin/ch-core-container-entrypoint"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:18080/health/ready',{signal:AbortSignal.timeout(3000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "dist/index.js"]

FROM node:24-bookworm-slim AS ops

ENV NODE_ENV=production
ENV NODE_OPTIONS=--max-old-space-size=160
ENV CH_CORE_MARIADB_BIN=/usr/bin/mariadb
ENV CH_CORE_MARIADB_DUMP_BIN=/usr/bin/mariadb-dump

RUN apt-get update \
    && apt-get install -y --no-install-recommends mariadb-client \
    && command -v mariadb >/dev/null \
    && command -v mariadb-dump >/dev/null \
    && rm -rf /var/lib/apt/lists/*

COPY server/scripts/container-entrypoint.sh /usr/local/bin/ch-core-container-entrypoint
COPY server/scripts /opt/ch-core-ops
RUN chmod 0555 /usr/local/bin/ch-core-container-entrypoint /opt/ch-core-ops/*.sh

USER node
ENTRYPOINT ["/usr/local/bin/ch-core-container-entrypoint"]
CMD ["/opt/ch-core-ops/health-check.sh"]
