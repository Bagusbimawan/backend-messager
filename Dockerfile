# ── Build stage ───────────────────────────────────────────────────
FROM oven/bun:1.3 AS builder

WORKDIR /app

COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src

# ── Runtime stage ─────────────────────────────────────────────────
FROM oven/bun:1.3-slim AS runtime

WORKDIR /app

# Copy only what's needed
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./
COPY --from=builder /app/tsconfig.json ./

RUN mkdir -p logs

EXPOSE 3000

# Bun runs TypeScript natively — no build step needed
CMD ["bun", "src/server.ts"]
