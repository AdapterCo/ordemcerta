# Imagem multi-stage para apps Node do monorepo (api | worker).
#   docker build -f infra/docker/node.Dockerfile --build-arg APP=api -t ordemcerta-api .
ARG NODE_VERSION=24-bookworm-slim

FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate
WORKDIR /app

FROM base AS build
ARG APP=api
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
RUN pnpm install --frozen-lockfile
COPY . .
RUN DATABASE_MIGRATION_URL=postgresql://build@localhost/build pnpm prisma generate \
 && pnpm --filter @ordemcerta/shared build \
 && pnpm --filter @ordemcerta/server build \
 && pnpm --filter @ordemcerta/${APP} build

FROM base AS runtime
ARG APP=api
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app /app
USER node
WORKDIR /app/apps/${APP}
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
