FROM node:20-bookworm AS builder

# Build client
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# Build server
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ ./
RUN npm run build

# Production image — Ubuntu Noble has glibc 2.39 for tectonic compatibility
FROM ubuntu:24.04

# Install Node.js 20, chktex, and runtime deps
RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    chktex \
    libgraphite2-3 \
    libicu74 \
    libharfbuzz0b \
    libfontconfig1 \
    libpng16-16 \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install tectonic via official installer
RUN curl -fsSL https://drop-sh.fullyjustified.net | sh \
    && mv tectonic /usr/local/bin/tectonic \
    && chmod +x /usr/local/bin/tectonic \
    && tectonic --help | head -1

WORKDIR /app

# Copy server
COPY --from=builder /app/server/dist ./dist
COPY --from=builder /app/server/package.json ./
COPY --from=builder /app/server/node_modules ./node_modules

# Copy client build
COPY --from=builder /app/client/dist ./client/dist

# Create data directory
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=8080
ENV DATABASE_PATH=/app/data/overleaf.db

EXPOSE 8080

CMD ["node", "dist/index.js"]