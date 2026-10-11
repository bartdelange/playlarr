FROM node:24-bookworm-slim AS build

ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /build

RUN apt-get update \
    && apt-get install --yes --no-install-recommends g++ make python3 \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@11.23.0

COPY . .

RUN pnpm install --frozen-lockfile \
    && pnpm nx run @playlarr/server:build \
    && pnpm nx run @playlarr/web:build \
    && CI=true pnpm install --prod --offline --frozen-lockfile --ignore-scripts \
    && mkdir -p /out/web/apps/web/.next \
    && cp -R apps/web/.next/standalone/. /out/web/ \
    && cp -R apps/web/.next/static /out/web/apps/web/.next/static \
    && cp -R apps/web/public /out/web/apps/web/public

FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    PLAYLARR_DATABASE_PATH=/data/playlarr.db \
    PLAYLARR_SERVER_HOST=127.0.0.1 \
    PLAYLARR_SERVER_PORT=3001

RUN usermod --uid 99 --gid 100 nobody \
    && mkdir -p /app /data \
    && chown nobody:users /app /data

WORKDIR /app

COPY --from=build --chown=nobody:users /build/node_modules /app/node_modules
COPY --from=build --chown=nobody:users /build/apps/server /app/apps/server
COPY --from=build --chown=nobody:users /build/libs /app/libs
COPY --from=build --chown=nobody:users /out/web /app/apps/web/.next/standalone

USER nobody:users

VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(response => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"]

ENTRYPOINT ["node", "/app/apps/server/dist/production-main.js"]
