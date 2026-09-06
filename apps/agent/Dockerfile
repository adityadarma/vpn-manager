FROM node:24-alpine AS base
# corepack pins pnpm to the `packageManager` field in package.json. Installing
# pnpm unpinned pulled pnpm 11, which rejects this repo's lockfile with
# "Cannot verify the identity of the @pnpm/exe.<arch> native binary".
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

# Builder stage
FROM base AS builder
WORKDIR /app

# Copy only dependency files first for better caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json turbo.json* ./
COPY apps/agent/package.json ./apps/agent/
COPY packages/shared/package.json ./packages/shared/

# Install dependencies with cache mount
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Copy source code after dependencies are installed
COPY apps/agent ./apps/agent
COPY packages/shared ./packages/shared
COPY apps/agent/tsup.config.ts ./apps/agent/tsup.config.ts

# Build the bundled Javascript code via tsup
RUN pnpm --filter @vpn/agent build

# Non-production target used only by the privileged CI live-test job. It keeps
# the test source and dev dependencies out of the final runner image.
FROM builder AS test

# Isolate app with only its required dependencies for a leaner image
FROM builder AS production-builder
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm deploy --filter @vpn/agent --prod /prod/agent

# Final minimal runner stage
FROM node:24-alpine AS runner
WORKDIR /app

ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="vpn-agent" \
  org.opencontainers.image.version="$VERSION" \
  org.opencontainers.image.revision="$REVISION"

# Install OpenSSL, Easy-RSA, WireGuard tools, and firewall engines
RUN apk add --no-cache bash openssl easy-rsa wireguard-tools iptables ip6tables nftables iproute2

COPY --from=production-builder /prod/agent /app
# Copy built dist from builder
COPY --from=builder /app/apps/agent/dist /app/dist

ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
