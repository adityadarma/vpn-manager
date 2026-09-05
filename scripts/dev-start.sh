#!/usr/bin/env bash
# VPN Manager — Quick Start Script
# Usage: ./scripts/dev-start.sh [dev|prod|docker|docker-dev]
set -e

MODE=${1:-dev}
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "🔷 VPN Manager"
echo "================================"

check_env() {
  if [ ! -f ".env" ]; then
    echo "📋 Creating .env from .env.example..."
    cp .env.example .env
    echo "⚠️  Please review .env and set your JWT_SECRET before production use."
  fi
}

run_migrations() {
  echo "🗄️  Running database migrations..."
  pnpm db:migrate
  echo "🌱 Seeding default data..."
  pnpm db:seed
}

case "$MODE" in
  dev)
    echo "🚀 Starting development servers..."
    check_env
    pnpm install
    run_migrations
    echo ""
    echo "   Web UI:   http://localhost:5173"
    echo "   API:      http://localhost:3000"
    echo "   API Docs: http://localhost:3000/docs"
    echo "   Login:    admin / password from the seed output or ADMIN_PASSWORD"
    echo ""
    pnpm dev
    ;;

  prod)
    echo "🏗️  Building for production..."
    check_env
    pnpm install
    pnpm build
    run_migrations
    echo "✅ Build complete. Starting API + built Web UI on http://localhost:3000"
    WEB_STATIC_PATH="$ROOT_DIR/apps/web/dist" NODE_ENV=production pnpm --filter @vpn/api start
    ;;

  docker)
    echo "🐳 Starting Docker development environment..."
    check_env
    docker compose -f docker-compose.dev.yml up -d
    echo "⏳ Waiting for the API container..."
    for _ in $(seq 1 60); do
      if docker compose -f docker-compose.dev.yml exec -T api true 2>/dev/null; then
        break
      fi
      sleep 2
    done
    if ! docker compose -f docker-compose.dev.yml exec -T api true 2>/dev/null; then
      echo "API container did not start within 120 seconds."
      docker compose -f docker-compose.dev.yml logs api
      exit 1
    fi
    docker compose -f docker-compose.dev.yml exec api sh -c "pnpm db:migrate && pnpm db:seed"
    echo ""
    echo "   Web UI:   http://localhost:5173"
    echo "   API:      http://localhost:3000"
    echo "   Login:    admin / password from the seed output or ADMIN_PASSWORD"
    echo ""
    ;;

  docker-dev)
    echo "🐳 Starting Docker development environment..."
    check_env
    docker compose -f docker-compose.dev.yml up
    ;;

  *)
    echo "Usage: $0 [dev|prod|docker|docker-dev]"
    exit 1
    ;;
esac
