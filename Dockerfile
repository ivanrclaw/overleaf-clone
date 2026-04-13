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

# Production image (use full bookworm for TeX Live + native modules)
FROM node:20-bookworm

# Install TeX Live (pdflatex for compilation) + chktex for linting
RUN apt-get update && apt-get install -y --no-install-recommends \
    chktex \
    texlive-latex-base \
    texlive-latex-recommended \
    texlive-latex-extra \
    texlive-fonts-recommended \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /tmp/* \
    && rm -rf /var/cache/apt/*

WORKDIR /app

# Copy server
COPY --from=builder /app/server/dist ./dist
COPY --from=builder /app/server/package.json ./
COPY --from=builder /app/server/node_modules ./node_modules

# Rebuild native modules (better-sqlite3) for this exact Node version
RUN npm rebuild better-sqlite3 2>/dev/null || npm rebuild

# Copy client build
COPY --from=builder /app/client/dist ./client/dist

# Create data directory
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=8080
ENV DATABASE_PATH=/app/data/overleaf.db

EXPOSE 8080

CMD ["node", "dist/index.js"]