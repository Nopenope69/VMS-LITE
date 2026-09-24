# syntax=docker/dockerfile:1

# ----------------------------------------------------
# Stage 1: Build stage
# ----------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Install build prerequisites (including python/make for native modules if required)
RUN apk add --no-cache python3 make g++

# Copy package manifests and prisma schema
COPY package*.json ./
COPY prisma ./prisma/

# Install all dependencies (including devDependencies for build)
RUN npm install

# Generate Prisma client
RUN npx prisma generate

# Copy application sources
COPY tsconfig.json ./
COPY src ./src/
COPY client ./client/

# Build backend and client TypeScript
RUN npm run build
RUN npx tsc -p client/tsconfig.json --noEmit

# ----------------------------------------------------
# Stage 2: Production runtime stage
# ----------------------------------------------------
FROM node:20-alpine AS runner

WORKDIR /app

# Add curl for container health checks
RUN apk add --no-cache curl

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Copy package manifests and prisma schema
COPY package*.json ./
COPY prisma ./prisma/

# Install production dependencies only
RUN npm install --omit=dev

# Generate Prisma client in production runtime
RUN npx prisma generate

# Copy built artifacts from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/client ./client

# Create directories for recordings and data with node user ownership
RUN mkdir -p /recordings /app/data && chown -R node:node /app /recordings

USER node

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
