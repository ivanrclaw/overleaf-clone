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

# Production image
FROM node:20-bookworm-slim

# Install chktex + tectonic runtime dependencies
RUN apt-get update && apt-get install -y \
    chktex \
    ca-certificates \
    curl \
    libgraphite2-3 \
    libicu72 \
    libharfbuzz0b \
    libfontconfig1 \
    libpng16-16 \
    && rm -rf /var/lib/apt/lists/*

# Install tectonic 0.16.8 from GitHub release
RUN curl -L https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%400.16.8/tectonic-0.16.8-x86_64-unknown-linux-gnu.tar.gz \
    | tar xz -C /usr/local/bin/ \
    && tectonic --version

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