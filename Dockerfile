# ============================================================
# Combined Web + API Dockerfile (CSR static + Fastify)
# ============================================================
# Vite SPA is built as static files.
# Fastify serves both the API and the static web files.
# Single process, single port (3000).
# ============================================================

FROM node:24-alpine AS base
# Use corepack rather than `npm install -g pnpm` so the pnpm version comes from
# the `packageManager` field in package.json.
#
# Installing pnpm unpinned pulled whatever was newest on npm (pnpm 11), which
# refuses to run against this repo's lockfile:
#   "Cannot verify the identity of the @pnpm/exe.linux-arm64 native binary:
#    it is missing from pnpm-lock.yaml"
# CI did not catch it because pnpm/action-setup already honours packageManager.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && apk add --no-cache python3 make g++ curl wget

# ============================================================
# Builder Stage
# ============================================================
FROM base AS builder
WORKDIR /app

# Copy dependency files for better caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/ui/package.json ./packages/ui/
COPY packages/db/package.json ./packages/db/
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/

# Install all dependencies
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
  pnpm install --frozen-lockfile

# Copy source code
COPY packages/shared ./packages/shared
COPY packages/ui ./packages/ui
COPY packages/db ./packages/db
COPY apps/web ./apps/web
COPY apps/api ./apps/api

# Build web (Vite static export -> /app/apps/web/dist)
RUN pnpm --filter @vpn/web build

# Build api (Fastify with tsup)
RUN pnpm --filter @vpn/api build

# Deploy production dependencies for API
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
  pnpm deploy --filter @vpn/api --prod /prod/api

# Copy built API bundle
RUN cp -r /app/apps/api/dist /prod/api/dist
RUN cp /app/apps/api/start.sh /prod/api/start.sh

# Copy packages/db (workspace local package, not included by pnpm deploy --prod)
RUN mkdir -p /prod/api/node_modules/@vpn/db
RUN cp -r /app/packages/db/src /prod/api/node_modules/@vpn/db/src
RUN cp -r /app/packages/db/node_modules /prod/api/node_modules/@vpn/db/node_modules 2>/dev/null || true

# Copy Vite static output -> will be served by Fastify
RUN cp -r /app/apps/web/dist /prod/web

# CI-only target. Keeps source and dev dependencies available for the compiled
# manager/agent process E2E harness without adding them to the runner image.
FROM builder AS test

# ============================================================
# Runner Stage
# ============================================================
FROM node:24-alpine AS runner
WORKDIR /app

ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="vpn-manager" \
  org.opencontainers.image.version="$VERSION" \
  org.opencontainers.image.revision="$REVISION"

# Install runtime dependencies
RUN apk add --no-cache curl wget bash
RUN npm install -g tsx

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S apiuser -u 1001

# Copy API files
COPY --from=builder --chown=apiuser:nodejs /prod/api /app/api
RUN chmod +x /app/api/start.sh

# Copy Vite static build (served by Fastify via @fastify/static)
COPY --from=builder --chown=apiuser:nodejs /prod/web /app/web

# Create data directory for SQLite
RUN mkdir -p /data && chown -R apiuser:nodejs /data

USER apiuser

ENV NODE_ENV=production
# Tell Fastify's static plugin where to find the web files
ENV WEB_STATIC_PATH=/app/web

# Expose single port — Fastify serves both API and web
EXPOSE 3000

# Health check
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/v1/health || exit 1

# Single entrypoint — the start.sh runs migrations then starts Fastify
CMD ["/app/api/start.sh"]
