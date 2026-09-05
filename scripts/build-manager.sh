#!/bin/bash
# ============================================================
# Build VPN Manager Image (Combined Web + API)
# ============================================================
# This script builds the combined Docker image for web and api
#
# Usage:
#   ./scripts/build-manager.sh
#   ./scripts/build-manager.sh --push  # Build and push to registry
# ============================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
IMAGE_NAME="${IMAGE_NAME:-ghcr.io/adityadarma/vpn-manager:latest}"
DOCKERFILE="Dockerfile"

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  VPN Manager - Build Manager Image${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Check if Dockerfile exists
if [ ! -f "$DOCKERFILE" ]; then
    echo -e "${RED}✗ Error: $DOCKERFILE not found${NC}"
    exit 1
fi

echo -e "${YELLOW}📦 Building manager image (web + api)...${NC}"
echo -e "   Image: ${GREEN}$IMAGE_NAME${NC}"
echo -e "   Dockerfile: ${GREEN}$DOCKERFILE${NC}"
echo ""

# Build the image
if docker build -f "$DOCKERFILE" -t "$IMAGE_NAME" .; then
    echo ""
    echo -e "${GREEN}✓ Build successful!${NC}"
    
    # Get image size
    IMAGE_SIZE=$(docker images "$IMAGE_NAME" --format "{{.Size}}")
    echo -e "   Image size: ${GREEN}$IMAGE_SIZE${NC}"
    
    # Show image details
    echo ""
    echo -e "${BLUE}Image details:${NC}"
    docker images "$IMAGE_NAME" --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedAt}}"
else
    echo ""
    echo -e "${RED}✗ Build failed!${NC}"
    exit 1
fi

# Push to registry if --push flag is provided
if [ "$1" == "--push" ]; then
    echo ""
    echo -e "${YELLOW}📤 Pushing to registry...${NC}"
    
    if docker push "$IMAGE_NAME"; then
        echo -e "${GREEN}✓ Push successful!${NC}"
    else
        echo -e "${RED}✗ Push failed!${NC}"
        exit 1
    fi
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✓ Done!${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo -e "  1. Test the image:"
echo -e "     ${GREEN}docker run -p 3000:3000 $IMAGE_NAME${NC}"
echo ""
echo -e "  2. Or use docker-compose:"
echo -e "     ${GREEN}docker compose -f docker-compose.prod.yml up -d${NC}"
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
