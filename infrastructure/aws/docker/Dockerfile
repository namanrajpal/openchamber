# Multi-stage Dockerfile for OpenChamber
# Uses Bun for build and runtime (as per project specs)

# ============================================
# Stage 1: Build OpenChamber
# ============================================
FROM oven/bun:1.3 AS builder

WORKDIR /build

# Copy workspace files
COPY package.json bun.lock ./
COPY packages/web/package.json ./packages/web/
COPY packages/ui/package.json ./packages/ui/

# Install all dependencies (including dev)
# --ignore-scripts skips node-pty compilation (bun-pty is used at runtime)
RUN bun install --ignore-scripts

# Copy source code
COPY packages/ ./packages/
COPY eslint.config.js ./
COPY tsconfig.json ./
COPY vite-theme-plugin.ts ./
COPY vite.config.ts ./
COPY postcss.config.js ./

# Build the web package
RUN bun run build:web

# ============================================
# Stage 2: Runtime
# ============================================
FROM oven/bun:1.3-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    openssh-client \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install OpenCode CLI - use npm to ensure correct binary selection
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    npm install -g opencode-ai && \
    rm -rf /var/lib/apt/lists/*

# Verify OpenCode CLI installed
RUN opencode --version || (echo "OpenCode CLI installation failed" && exit 1)

# Create app directory
WORKDIR /app

# Copy built artifacts from builder
COPY --from=builder /build/packages/web/dist ./dist
COPY --from=builder /build/packages/web/server ./server
COPY --from=builder /build/packages/web/bin ./bin
COPY --from=builder /build/packages/web/public ./public
COPY --from=builder /build/packages/web/package.json ./

# Install production dependencies only
# --ignore-scripts skips node-pty compilation (bun-pty is used at runtime)
RUN bun install --ignore-scripts --production

# Copy entrypoint script
COPY infrastructure/aws/docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Copy seed repositories to /app/seed-repos (will be copied to workspace on first run)
# This allows baked-in repos to work even when /workspace is mounted as EFS volume
RUN mkdir -p /app/seed-repos
COPY infrastructure/aws/docker/repos /app/seed-repos
RUN rm -f /app/seed-repos/.gitkeep

# Expose OpenChamber port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/api/health || exit 1

# Run as non-root user for security (create user)
RUN groupadd -r openchamber && useradd -r -g openchamber openchamber

# Create workspace directory (used as HOME for the non-root user)
# This is needed when running without an external volume mount
RUN mkdir -p /workspace && chown openchamber:openchamber /workspace

RUN chown -R openchamber:openchamber /app

# Switch to non-root user
USER openchamber

ENTRYPOINT ["/entrypoint.sh"]
