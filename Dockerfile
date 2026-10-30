FROM oven/bun:1.3.8 AS bun

FROM node:22-bookworm-slim AS build
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Sub-path the app is served under (e.g. /tracksem); SvelteKit bakes it in at build time
ARG TRACKSEM_BASE_PATH=""
ENV TRACKSEM_BASE_PATH=$TRACKSEM_BASE_PATH
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts && npm rebuild better-sqlite3
COPY . .
RUN bun run build
RUN bun install --production --frozen-lockfile --ignore-scripts && npm rebuild better-sqlite3

FROM node:22-bookworm-slim AS runtime
ARG TRACKSEM_BASE_PATH=""
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 TRACKSEM_DB_PATH=/app/data/tracksem.db \
    TRACKSEM_BASE_PATH=$TRACKSEM_BASE_PATH
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/build ./build
COPY --from=build --chown=node:node /app/scripts/create-user.mjs ./scripts/
RUN mkdir data && chown node:node data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000' + process.env.TRACKSEM_BASE_PATH + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "build"]
