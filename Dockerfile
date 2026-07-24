# ============================================
# Multi-stage Dockerfile para Next.js + Prisma
# Optimizado para deploy en Coolify
# ============================================

# --- Stage 1: Dependencies ---
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json* ./
COPY prisma ./prisma/
# NODE_ENV= fuerza instalación de devDependencies (requeridas para el build)
RUN NODE_ENV= npm ci

# --- Stage 2: Build ---
FROM node:20-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build-time env (Coolify la inyectaba; en GitHub Actions llega como build-arg).
# NEXT_PUBLIC_SITE_URL se incrusta en el bundle, debe ser real.
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
RUN npx prisma generate
RUN NODE_ENV=production npm run build

# --- Stage 3: Production ---
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# ffmpeg para extracción de audio en procesamiento de video
RUN apk add --no-cache ffmpeg

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma

# Prisma Client runtime (NO incluye CLI para evitar dependencia de 'effect')
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client

# Script de migración (usa PrismaClient, no el CLI)
COPY --from=builder /app/scripts ./scripts

# Next.js standalone output (incluye su propio node_modules mínimo)
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Directorio de uploads (Docker volume lo sobreescribirá)
RUN mkdir -p /uploads && chown nextjs:nodejs /uploads

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV UPLOAD_DIR=/uploads

# Migrar BD con script propio (no usa CLI de Prisma → no requiere 'effect')
CMD ["sh", "-c", "node /app/scripts/migrate.cjs 2>&1; node server.js"]
