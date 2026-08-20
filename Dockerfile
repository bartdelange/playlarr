FROM node:24-bookworm-slim AS builder

ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=8787 \
    DATA_DIR=/config/data \
    OUTPUT_DIR=/playlists

RUN apt-get update \
    && apt-get install --no-install-recommends --yes gosu \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /config /playlists \
    && chown node:node /config /playlists

WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY scripts/container-entrypoint.sh /usr/local/bin/playlarr-entrypoint

EXPOSE 8787
VOLUME ["/config", "/playlists"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:8787/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

ENTRYPOINT ["/usr/local/bin/playlarr-entrypoint"]
