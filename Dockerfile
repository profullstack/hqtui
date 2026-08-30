# HQTUI marketing site — one Railway service, built from the monorepo root.
FROM oven/bun:1.4 AS base
WORKDIR /app

# --- dependencies -----------------------------------------------------------
FROM base AS deps
COPY package.json bun.lock* bunfig.toml ./
COPY packages/hqtui/package.json packages/hqtui/
COPY apps/web/package.json apps/web/
COPY apps/demo/package.json apps/demo/
COPY apps/benchmark/package.json apps/benchmark/
COPY examples/package.json examples/
RUN bun install --frozen-lockfile

# --- build ------------------------------------------------------------------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY . .
# The site imports the library from source-built dist, so build it first.
RUN cd packages/hqtui && bun x tsc -p tsconfig.build.json
ENV NEXT_TELEMETRY_DISABLED=1
RUN cd apps/web && bun run build

# --- runtime ----------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3000
CMD ["bun", "apps/web/server.js"]
