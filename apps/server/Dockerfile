# syntax=docker/dockerfile:1
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
# pnpm needs every workspace member's manifest present to resolve --frozen-lockfile against the
# lockfile's full dependency graph correctly (even members this image never builds) — a partial
# set here produces a different, incompatible virtual-store layout than the lockfile expects and
# breaks module resolution for packages this image DOES need (e.g. prisma under packages/database).
COPY packages/config/package.json ./packages/config/package.json
COPY packages/types/package.json ./packages/types/package.json
COPY packages/ui/package.json ./packages/ui/package.json
COPY packages/database/package.json ./packages/database/package.json
COPY apps/server/package.json ./apps/server/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY packages ./packages
COPY apps/server ./apps/server
COPY turbo.json ./turbo.json
RUN pnpm --filter @bmp/database generate
RUN pnpm --filter @bmp/server build

FROM base AS runner
ENV NODE_ENV=production
RUN addgroup -S bmp && adduser -S bmp -G bmp
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=build /app/packages/database ./packages/database
COPY --from=build /app/packages/types ./packages/types
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/src ./apps/server/src
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/node_modules ./apps/server/node_modules
USER bmp
EXPOSE 4000
# @bmp/database (like @bmp/types/@bmp/ui) is an intentionally unbuilt raw-TS workspace package —
# tsc compiles apps/server's own code to dist/ but leaves `import ... from "@bmp/database"` as a
# reference to its raw .ts source, which plain `node` cannot load at runtime ("Unknown file
# extension .ts"). tsx provides the same on-the-fly TS resolution here as it does for `pnpm dev`.
CMD ["./apps/server/node_modules/.bin/tsx", "apps/server/dist/index.js"]
