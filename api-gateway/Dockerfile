# ── Builder Stage ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

# ── Runtime Stage ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
EXPOSE 8000
CMD ["node", "src/index.js"]