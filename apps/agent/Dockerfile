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

# Isolate app with only its required dependencies for a leaner image
FROM builder AS production-builder
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm deploy --filter @vpn/agent --prod /prod/agent

# Alpine's iptables package ships only the nft backend. Build a musl-compatible
# legacy backend for hosts that still route VPN traffic through iptables-legacy.
FROM base AS iptables-legacy-builder
ARG IPTABLES_VERSION=1.8.11
ARG IPTABLES_SHA256=d87303d55ef8c92bcad4dd3f978b26d272013642b029425775f5bad1009fe7b2
WORKDIR /build
RUN apk add --no-cache bash build-base linux-headers autoconf automake libtool \
    pkgconf curl xz
RUN curl --fail --location --silent --show-error \
    "https://www.netfilter.org/projects/iptables/files/iptables-${IPTABLES_VERSION}.tar.xz" \
    --output iptables.tar.xz \
    && echo "${IPTABLES_SHA256}  iptables.tar.xz" | sha256sum -c - \
    && tar -xJf iptables.tar.xz \
    && cd "iptables-${IPTABLES_VERSION}" \
    && CONFIG_SHELL=/bin/bash /bin/bash ./configure \
      --prefix=/opt/iptables-legacy \
      --sbindir=/opt/iptables-legacy/sbin \
      --libdir=/opt/iptables-legacy/lib \
      --libexecdir=/opt/iptables-legacy/lib/xtables \
      --program-suffix=-legacy \
      --disable-nftables \
      --disable-static \
      CFLAGS='-D__UAPI_DEF_ETHHDR=0' \
    && make -j"$(getconf _NPROCESSORS_ONLN)" CFLAGS='-D__UAPI_DEF_ETHHDR=0' \
    && make install \
    && ln -s xtables-legacy-multi-legacy /opt/iptables-legacy/sbin/xtables-legacy-multi

# Non-production target used only by the privileged CI live-test job. Keep the
# test source and provide the same legacy backend as the production runner.
FROM builder AS test
COPY --from=iptables-legacy-builder /opt/iptables-legacy /opt/iptables-legacy
RUN mkdir -p /usr/local/sbin \
    && printf '%s\n' \
    '#!/bin/sh' \
    'export LD_LIBRARY_PATH=/opt/iptables-legacy/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}' \
    'export XTABLES_LIBDIR=/opt/iptables-legacy/lib/xtables' \
    'exec /opt/iptables-legacy/sbin/iptables-legacy "$@"' \
    > /usr/local/sbin/iptables-legacy \
    && chmod +x /usr/local/sbin/iptables-legacy

# Final minimal runner stage
FROM node:24-alpine AS runner
WORKDIR /app

ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="vpn-agent" \
  org.opencontainers.image.version="$VERSION" \
  org.opencontainers.image.revision="$REVISION"

# Keep the nft backend from Alpine and add the separately-built legacy backend.
RUN apk add --no-cache bash openssl easy-rsa wireguard-tools iptables ip6tables nftables iproute2 firewalld
COPY --from=iptables-legacy-builder /opt/iptables-legacy /opt/iptables-legacy
RUN mkdir -p /usr/local/sbin \
    && printf '%s\n' \
    '#!/bin/sh' \
    'export LD_LIBRARY_PATH=/opt/iptables-legacy/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}' \
    'export XTABLES_LIBDIR=/opt/iptables-legacy/lib/xtables' \
    'exec /opt/iptables-legacy/sbin/iptables-legacy "$@"' \
    > /usr/local/sbin/iptables-legacy \
    && chmod +x /usr/local/sbin/iptables-legacy

COPY --from=production-builder /prod/agent /app
# Copy built dist from builder
COPY --from=builder /app/apps/agent/dist /app/dist

ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
