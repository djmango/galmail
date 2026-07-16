# Homelab API (Bun + Hono). Build from repo root:
#   docker build -f services/homelab-api/Dockerfile -t galmail-homelab-api .
FROM oven/bun:1.3.14-alpine AS deps
WORKDIR /app
COPY services/homelab-api/package.json ./
RUN bun install --production --no-save

FROM oven/bun:1.3.14-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY services/homelab-api/package.json ./
COPY services/homelab-api/src ./src
EXPOSE 8789
USER bun
CMD ["bun", "run", "src/index.ts"]
