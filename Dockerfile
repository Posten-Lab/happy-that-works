# Standalone talos-server: single container, no external dependencies
# Uses PGlite (embedded Postgres), local filesystem storage, no Redis

# Stage 1: install dependencies
FROM node:20 AS deps
COPY --from=oven/bun:1.4.2 /usr/local/bin/bun /usr/local/bin/bun

RUN apt-get update && apt-get install -y python3 make g++ build-essential && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY patches ./patches
COPY scripts ./scripts

RUN mkdir -p packages/talos-app packages/talos-server packages/talos-cli packages/talos-agent packages/talos-wire

COPY packages/talos-app/package.json packages/talos-app/
COPY packages/talos-server/package.json packages/talos-server/
COPY packages/talos-cli/package.json packages/talos-cli/
COPY packages/talos-agent/package.json packages/talos-agent/
COPY packages/talos-wire/package.json packages/talos-wire/

# Workspace postinstall requirements
COPY packages/talos-app/patches packages/talos-app/patches
COPY packages/talos-server/prisma packages/talos-server/prisma
COPY packages/talos-cli/scripts packages/talos-cli/scripts
COPY packages/talos-cli/tools packages/talos-cli/tools

RUN ELECTRON_SKIP_BINARY_DOWNLOAD=1 SKIP_TALOS_WIRE_BUILD=1 pnpm install --frozen-lockfile

# Stage 2: copy source and type-check
FROM deps AS builder

COPY packages/talos-wire ./packages/talos-wire
COPY packages/talos-server ./packages/talos-server
# Server contract tests type-check against the client API types.
COPY packages/talos-app/sources ./packages/talos-app/sources

RUN pnpm --filter @talos/wire build
RUN pnpm --filter talos-server build

# Stage 3: runtime
FROM node:20-slim AS runner

WORKDIR /repo

RUN apt-get update && apt-get install -y ffmpeg curl && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PGLITE_DIR=/data/pglite

COPY --from=builder /repo/node_modules /repo/node_modules
COPY --from=builder /repo/packages/talos-wire /repo/packages/talos-wire
COPY --from=builder /repo/packages/talos-server /repo/packages/talos-server

VOLUME /data
EXPOSE 3005

WORKDIR /repo/packages/talos-server

CMD ["sh", "-c", "../../node_modules/.bin/tsx sources/standalone.ts migrate && exec ../../node_modules/.bin/tsx sources/standalone.ts serve"]
