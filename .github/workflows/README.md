# GitHub Actions Workflows

## Docker Build and Push

Builds and pushes Docker images for VPN Manager.

### Images

- `ghcr.io/OWNER/vpn-manager:latest` - Manager (web + api)
- `ghcr.io/OWNER/vpn-agent:latest` - Agent

### Triggers

**1. Manual (workflow_dispatch)**

- Go to Actions → Run workflow
- Select images: `all`, `manager`, or `agent`
- Choose whether to push to registry

**2. Version Tags**

```bash
git tag v1.0.0
git push origin v1.0.0
```

Automatically builds and pushes both images with version tags.

**3. Changes merged or pushed to main**

- CI runs only when commits are pushed to `main`, including commits created by merging a pull request into `main`.
- CI does not run when a pull request is opened or updated before it is merged.
- Version tags run the separate Release workflow, including a fresh test pass before publishing images.

## GitHub Pages

Documentation deploys only from stable release tags such as `v1.2.3`. In repository **Settings** > **Pages**, set **Source** to **GitHub Actions**. Do not use **Deploy from a branch**; it creates GitHub's separate `pages build and deployment` workflow on each push to the selected branch.

The published documentation URL is `https://adityadarma.github.io/vpn-manager/`.

### Workflow Jobs

**1. prepare**

- Detects which images to build
- Smart detection based on changed files

**2. build-and-push**

- Builds Docker images
- Pushes to GitHub Container Registry
- Uses build cache for speed

**3. test-deployment**

- Tests manager deployment
- Verifies API and Web UI
- Only runs if manager was built

**4. create-release**

- Creates GitHub Release
- Only runs on version tags

### Testing

Test deployment:

1. Pulls manager image
2. Starts with docker-compose
3. Waits for services (max 2 min)
4. Tests health endpoints
5. Shows logs on failure

### Local Build

```bash
# Build manager
docker compose build

# Build agent
docker compose -f docker-compose.agent.yml build
```

### Troubleshooting

**Build fails:**

- Check Dockerfile syntax
- Test locally first
- Check workflow logs

**Test fails:**

- Check manager logs in workflow
- Verify healthcheck endpoints
- Increase wait time if needed

**Images not pushed:**

- Verify `push_images: true`
- Check GITHUB_TOKEN permissions
- Verify workflow completed

### Support

- [Deployment Guide](../../docs/DEPLOYMENT-GUIDE.md)
- [GitHub Issues](https://github.com/adityadarma/vpn-manager/issues)
