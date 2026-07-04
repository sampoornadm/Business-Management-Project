# syntax=docker/dockerfile:1
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
# pnpm needs every workspace member's manifest present to resolve --frozen-lockfile against the
# lockfile's full dependency graph correctly (even members this image never builds) — a partial
# set here produces a different, incompatible virtual-store layout than the lockfile expects.
COPY packages/config/package.json ./packages/config/package.json
COPY packages/types/package.json ./packages/types/package.json
COPY packages/ui/package.json ./packages/ui/package.json
COPY packages/database/package.json ./packages/database/package.json
COPY apps/server/package.json ./apps/server/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY packages ./packages
COPY apps/web ./apps/web
COPY turbo.json ./turbo.json
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN pnpm --filter @bmp/web build

FROM base AS runner
ENV NODE_ENV=production
RUN addgroup -S bmp && adduser -S bmp -G bmp
COPY --from=build /app/apps/web/public ./apps/web/public
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
USER bmp
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
