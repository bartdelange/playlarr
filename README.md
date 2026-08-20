# Playlarr

Playlarr turns ordered Spotify and TIDAL playlists into safely planned Lidarr additions and local
M3U8 playlists. It is a full-stack Next.js 16 and TypeScript application with SQLite-backed
workflows and a durable single-concurrency worker.

Playlist order and duplicate occurrences are preserved. MusicBrainz mappings, manual decisions,
source identifiers, revisions, local Navidrome additions, jobs, plans, and exports remain durable
in the schema-v8 database. Lidarr planning is read-only; mutations require approval of a persisted
plan and are revalidated at execution time. Interrupted mutation jobs are never replayed
automatically.

## Run locally

Node.js 22 or newer is required.

```bash
npm ci
cp .env.example .env
npm run dev
```

Open `http://127.0.0.1:8787`. On first use, create a password or explicitly choose gateway-managed
authentication. The health endpoint is `GET /health` and returns `{"status":"ok"}`.

The web process does not execute long-running work. Start the durable worker in a second terminal:

```bash
npm run worker
```

## Configuration

Configuration can come from environment variables and, for service values, the Settings page.
Values saved in SQLite take precedence where applicable. Secrets are replacement-only in the UI
and are never sent to Client Components.

- `DATA_DIR` — database directory; defaults to `.data`.
- `OUTPUT_DIR` — M3U8 and CSV report directory; defaults to `output`.
- `MUSICBRAINZ_USER_AGENT` — identifying contact string required by MusicBrainz.
- `SPOTIFY_CLIENT_ID`, `SPOTIFY_REDIRECT_URI`, `SPOTIFY_TOKEN_CACHE` — Spotify PKCE.
- `TIDAL_CLIENT_ID`, `TIDAL_REDIRECT_URI`, `TIDAL_SESSION_FILE` — TIDAL OAuth PKCE.
- `LIDARR_URL`, `LIDARR_API_KEY`, `LIDARR_ROOT_FOLDER`, `LIDARR_QUALITY_PROFILE_ID`,
  `LIDARR_METADATA_PROFILE_ID` — Lidarr.
- `NAVIDROME_URL`, `NAVIDROME_USERNAME`, `NAVIDROME_PASSWORD` — optional read-only lookup.
- `PLAYLARR_AUTH_ENABLED` — defaults to true; disable only behind a trusted gateway that protects
  every route.

Spotify redirects to `/callback`; TIDAL redirects to `/api/tidal/callback`. Register the public
URLs that actually reach Playlarr.

## Docker and Unraid

The production image contains one Next.js standalone server and one durable Node worker. It exposes
port `8787`, runs application processes as UID/GID `1000:1000`, and stores state in:

- `/config/data/music-importer.db` — existing schema-v8 database;
- `/config/secrets` — OAuth sessions;
- `/playlists` — M3U8 and CSV output.

```bash
cp .env.example .env
mkdir -p container-config container-playlists
docker compose up -d --build
docker compose ps
```

The entrypoint prepares mounted directories, forwards termination signals, and shuts down both
processes when either exits. The included `playlarr.xml` preserves the same port, mounts, environment
variables, and UID/GID expectations for Unraid.

When upgrading from the Python release, keep the existing `/config` and `/playlists` mounts. The
Node application opens the schema-v8 database in place; no reset or import is required.

## Workflow

1. Authenticate Spotify or TIDAL and acquire a playlist through the durable worker.
2. Resolve tracks with MusicBrainz; review ambiguous results or reuse exact-ISRC mappings.
3. Build a read-only Lidarr plan. Downloaded recordings and Various Artists safeguards are applied
   before any mutation is shown.
4. Approve the exact persisted plan. Execution re-reads Lidarr state and records every outcome.
5. Refresh downloaded library files, add optional read-only Navidrome tracks, and generate M3U8.
6. Review source-playlist changes through an immutable preview before applying a revision.

Mapping and unresolved CSV reports are written after resolution. Playlist generation preserves
positions and duplicate file occurrences.

## Validation

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
docker build -t playlarr .
```

Automated provider tests use deterministic transports and do not require credentials. Live OAuth
and service smoke checks are deployment verification, not build prerequisites.

See [CONTRIBUTING.md](CONTRIBUTING.md), [security guidance](docs/security.md), and the
[release guide](docs/releasing.md).
