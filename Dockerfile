# syntax=docker/dockerfile:1

# ----------------------------------------------------
# Stage 1: build server + web client
# ----------------------------------------------------
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Toolchain for native modules (bcrypt) and OpenSSL for Prisma engines
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci

COPY tsconfig.json tsconfig.build.json index.ts ./
COPY src ./src/
COPY client ./client/

RUN npx prisma generate \
  && npm run build \
  && npm run build:client \
  && npm prune --omit=dev

# ----------------------------------------------------
# Stage 2: runtime
# ----------------------------------------------------
FROM node:22-bookworm-slim AS runner

# ffmpeg: clip export; curl: healthcheck; openssl: Prisma; tzdata: schedule timezone (TZ)
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg curl openssl ca-certificates tzdata \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    RECORDINGS_PATH=/recordings \
    EXPORTS_PATH=/app/data/exports \
    SNAPSHOTS_PATH=/app/data/snapshots \
    BACKUPS_PATH=/app/data/backups

WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/client/dist ./client/dist

RUN mkdir -p /recordings /app/data/exports /app/data/snapshots /app/data/backups \
  && chown -R node:node /recordings /app/data

USER node

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/health" || exit 1

# Apply pending database migrations, then start the control plane
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && exec node dist/index.js"]
