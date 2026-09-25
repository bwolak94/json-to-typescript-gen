FROM node:22-alpine AS base
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# ─── Dependencies ─────────────────────────────────────────────────────────────

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/cli/package.json ./packages/cli/
COPY packages/core/package.json ./packages/core/

RUN pnpm install --frozen-lockfile --prod

# ─── Build ────────────────────────────────────────────────────────────────────

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY packages/ ./packages/

RUN pnpm install --frozen-lockfile
RUN pnpm build

# ─── Runtime ──────────────────────────────────────────────────────────────────

FROM node:22-alpine AS runtime
WORKDIR /app

# Copy built artifacts and production dependencies
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/core/package.json ./packages/core/
COPY --from=build /app/packages/cli/dist ./packages/cli/dist
COPY --from=build /app/packages/cli/package.json ./packages/cli/
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/cli/node_modules ./packages/cli/node_modules
COPY --from=deps /app/packages/core/node_modules ./packages/core/node_modules

# Create symlink so `node packages/cli/dist/index.js` works as the entrypoint
RUN ln -s /app/packages/cli/dist/index.js /usr/local/bin/qms && chmod +x /usr/local/bin/qms

# Default mock directory — mount your own mocks here
RUN mkdir -p /app/mocks

EXPOSE 3999

# Bind to all interfaces so the port is reachable from the host
ENV QMS_HOST=0.0.0.0

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3999/__admin/health || exit 1

CMD ["node", "/app/packages/cli/dist/index.js", "start"]
