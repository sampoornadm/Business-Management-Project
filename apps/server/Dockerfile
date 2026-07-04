# syntax=docker/dockerfile:1
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/config/package.json ./packages/config/package.json
COPY packages/types/package.json ./packages/types/package.json
COPY packages/database/package.json ./packages/database/package.json
COPY apps/server/package.json ./apps/server/package.json
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
CMD ["node", "apps/server/dist/index.js"]
