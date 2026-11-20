# Stage 1: Build TypeScript backend (southamerica-west1 Cloud Run)
FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.base.json tsconfig.json ./
COPY src ./src

RUN npm run build

# Stage 2: Minimal Sovereign Production Runtime
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV GCP_LOCATION=southamerica-west1

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY web/public/branding/master_logotype.png ./web/public/branding/master_logotype.png

RUN chown -R node:node /app
USER node

EXPOSE 8080

CMD ["node", "dist/index.js"]
