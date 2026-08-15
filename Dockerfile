FROM python:3.13-slim AS builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /build
COPY pyproject.toml README.md ./
COPY src ./src
RUN python -m pip wheel --wheel-dir /wheels .

FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DATA_DIR=/data \
    OUTPUT_DIR=/playlists \
    TIDAL_SESSION_FILE=/secrets/tidal-session.json \
    SPOTIFY_TOKEN_CACHE=/secrets/spotify-token.json

RUN groupadd --gid 1000 music-importer \
    && useradd --uid 1000 --gid music-importer --create-home music-importer \
    && mkdir -p /data /playlists /secrets \
    && chown -R music-importer:music-importer /data /playlists /secrets

COPY --from=builder /wheels /wheels
RUN python -m pip install --no-cache-dir /wheels/* && rm -rf /wheels

WORKDIR /app
EXPOSE 8787
VOLUME ["/data", "/playlists", "/secrets"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8787/health', timeout=3)"]

ENTRYPOINT ["python", "-m", "music_importer.container_entrypoint"]
CMD ["python", "-m", "uvicorn", "music_importer.web:create_app", "--factory", "--host", "0.0.0.0", "--port", "8787"]
