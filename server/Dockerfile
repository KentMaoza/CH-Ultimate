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

USER node
EXPOSE 3000

CMD ["node", "dist/index.js"]
