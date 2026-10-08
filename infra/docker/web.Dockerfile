# Frontend estático servido por Nginx (atrás do Traefik).
FROM node:24-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
RUN pnpm install --frozen-lockfile --filter @ordemcerta/web... --filter @ordemcerta/shared
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @ordemcerta/shared build && pnpm --filter @ordemcerta/web build

FROM nginx:1.29-alpine AS runtime
COPY infra/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/healthz || exit 1
