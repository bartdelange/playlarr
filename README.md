# Music Importer

Music Importer is a local, GUI-first application for bringing Spotify and TIDAL playlists into a Lidarr-managed library. It resolves recordings through MusicBrainz, pauses for human review only when necessary, previews every Lidarr change, follows download state, and generates ordered M3U8 playlists.

The application runs entirely on your computer and binds only to `127.0.0.1`.

## Architecture

The installed `music-import` command starts the process through `app/`. FastAPI composition,
capability-oriented routes, templates, and static assets live under `web/`; source-neutral use cases
live under `application/` and `workflows/`; and provider-independent records and rules live under
`domain/`. Spotify, TIDAL, MusicBrainz, and Lidarr details are isolated under `integrations/`.
SQLite repositories and migrations live under `persistence/`, while CSV and M3U formats live under
`exports/`.

SQLite is the durable application state. CSV reports and M3U8 playlists are exports, not inputs to
the core workflow, except for the explicit legacy CSV import path. Background work is executed by
the in-process task manager and records progress in SQLite, so interrupted work is visible after a
restart.

## Setup

Prerequisites are Python 3.12+, [`uv`](https://docs.astral.sh/uv/), a Spotify or TIDAL account, and a MusicBrainz-compliant User-Agent containing contact information.

```bash
uv sync
cp .env.example .env
uv run music-import
```

`music-import` starts the server at `http://127.0.0.1:8787`. Open that address when you want to use the interface. Use `music-import --debug` for diagnostic logging.

The GUI stores resumable import state in `.data/music-importer.db`. The file is created with owner-only permissions where supported. Existing `.env` values are used as initial settings; settings saved in the GUI override them. Secret fields are replacement-only and are never rendered back into the page.

### Configuration

Copy `.env.example` and set `MUSICBRAINZ_USER_AGENT` to an identifying value with a real contact
address or URL. Spotify requires `SPOTIFY_CLIENT_ID`; Lidarr requires both `LIDARR_URL` and
`LIDARR_API_KEY`.

Storage defaults to `.data`, `output`, and `.secrets`. `DATA_DIR`, `OUTPUT_DIR`,
`TIDAL_SESSION_FILE`, and `SPOTIFY_TOKEN_CACHE` may override those locations. The complete list of
service settings and defaults is documented in [`.env.example`](.env.example). Values saved through
the GUI take precedence, except explicit `DATA_DIR` and `OUTPUT_DIR` deployment overrides.

## Docker and Unraid

The container listens on `0.0.0.0:8787`; the normal `music-import` launcher remains localhost-only. The web UI has no login screen, so expose it only on a trusted LAN or put authentication in front of it. Do not publish it directly to the internet.

Published GitHub releases produce `linux/amd64` images at
`ghcr.io/bartdelange/tidal-to-lidarr`. The root-level
[`tidal-to-lidarr.xml`](tidal-to-lidarr.xml) file is a native Unraid Docker template. Copy it to
`/boot/config/plugins/dockerMan/templates-user/my-tidal-to-lidarr.xml`, refresh the Docker page,
choose **Add Container**, and select `tidal-to-lidarr` from **User templates**. The package must be
public in GitHub Container Registry for anonymous pulls; a private package requires GHCR
credentials on the server.

The container creates its persistent directories on first start and makes the mount roots writable
by the application user. To prepare them manually instead:

```bash
mkdir -p /mnt/user/appdata/tidal-to-lidarr/{data,secrets,output}
chown -R 1000:1000 /mnt/user/appdata/tidal-to-lidarr
```

The template tracks `latest` so Unraid can detect published updates. Pin its Repository field to a
release such as `ghcr.io/bartdelange/tidal-to-lidarr:0.1.0` when controlled upgrades are preferred.

### Releases

Releases are driven by annotated semantic-version tags. The guarded release helper prepares the
version change on a branch, validates it, pushes it, and opens the required pull request:

```bash
uv run python scripts/release.py prepare patch  # or minor / major
```

After merging the generated release PR, update local `master` and publish it:

```bash
git switch master
git pull --ff-only
uv run python scripts/release.py publish
```

Both commands require a clean `master` that exactly matches `origin/master`. `prepare` uses
`uv version` to update both `pyproject.toml` and `uv.lock`, runs formatting, linting, the full unit
suite, and the package build, then opens a non-draft PR. `publish` refuses to move or reuse an
existing tag and pushes an annotated tag for the merged project version.

The release workflow verifies that the tag matches the project version, runs formatting, linting,
tests, and the package build, then publishes the versioned and `latest` GHCR images with provenance.
The GitHub release and generated notes are created only after the image is published successfully.
If validation fails, correct the release commit and use a new version rather than moving a published
version tag.

For local development, the repository also includes a Compose configuration:

```bash
cp .env.example .env
mkdir -p container-data container-playlists container-secrets
docker compose up -d --build
```

Open `http://UNRAID-IP:8787`. The mounts contain:

- `/data`: SQLite state and all resumable workflow progress;
- `/playlists`: generated M3U8 files;
- `/secrets`: Spotify token and TIDAL session files.

For an Unraid Compose stack, replace the relative host paths with persistent shares such as:

```yaml
volumes:
  - /mnt/user/appdata/music-importer/data:/data
  - /mnt/user/appdata/music-importer/secrets:/secrets
  - /mnt/user/music:/playlists
```

The startup process prepares the three mount roots and then runs the application as UID/GID
`1000:1000`. To move the current installation without losing progress, stop the local application
and copy `.data/music-importer.db` to the host directory mounted at `/data/music-importer.db`.

Spotify's current PKCE helper expects its browser and callback listener on the same machine. For a headless Unraid deployment, authenticate once with the local application and copy `.secrets/spotify-token.json` to the directory mounted at `/secrets/spotify-token.json`. Keep the same Spotify client ID. TIDAL's device login is suitable for the container and persists its session under `/secrets`.

The health check is available at `/health`. View status and logs with:

```bash
docker compose ps
docker compose logs -f music-importer
```

## Workflow

1. Open **Settings**, configure MusicBrainz, Spotify, and Lidarr, then test the connections.
2. Select **New Import** and authenticate with Spotify or TIDAL.
3. Browse or filter playlists. Playlist analysis is explicit because MusicBrainz analysis can be expensive.
4. Import a playlist and start resolution. Work runs in a persisted, cancellable background job.
5. Review unresolved or suspicious tracks. Search MusicBrainz or paste a recording MBID, inspect validation evidence, and explicitly accept warnings when appropriate.
6. Preview the Lidarr plan. Planning is read-only; Lidarr is changed only after **Apply to Lidarr**.
7. Refresh download/library status after Lidarr has had time to download albums.
8. Generate or refresh the M3U8 playlist. Saved path mappings translate Lidarr paths for the playlist consumer.

Imports, source entries, resolution evidence, manual decisions, Lidarr plans, execution results, jobs, library state, and generated-playlist information survive restarts. Original playlist positions and duplicate entries are retained.

Live source catalogue reads, initial playlist acquisition, update previews, and impact analysis run as
persisted background jobs so slow Spotify or TIDAL responses do not hold the browser request open.
Catalogue reads remain live: choosing a source starts a fresh read rather than reusing a cached list.

An existing import can be refreshed with **Update playlist**. The app previews additions, removals, and moves before applying them. Stable source-track IDs and ISRCs retain existing automatic and manual mappings, including duplicate occurrences; new tracks return to resolution. Each applied update stores before-and-after snapshots that can be inspected from the import's update history.

## Authentication

### Spotify

Create a Spotify application and register the configured redirect URI, which defaults to `http://127.0.0.1:8765/callback`. Authentication uses Authorization Code with PKCE; no client secret is required. Tokens default to `.secrets/spotify-token.json`.

### TIDAL

TIDAL uses its device login flow and reuses the configured session file. Playlist folders are traversed recursively.

## Matching and safety

Automatic resolution still uses the original guarded behavior:

- normalized ISRC lookup first;
- title-and-primary-artist search only as fallback;
- guarded title overlap and similarity thresholds;
- remix/edit/version-marker protection;
- source-album-aware canonical release selection;
- MusicBrainz rate limiting and temporary-failure retries.

Manual MBIDs are fetched as recording entities and checked for artist, title, duration, ISRC, and release-group compatibility before they can be accepted. Confirmed manual mappings are not replaced by later automatic runs unless the override is explicitly cleared.

Lidarr synchronization remains additive. It does not monitor unrelated albums, sets new-item monitoring to `none`, never adds or changes Various Artists, reuses downloaded canonical releases, recognizes recording IDs and guarded alternate-version title matches, and avoids redundant searches when an approved plan is replayed.

## Playlist generation

M3U8 generation queries downloaded Lidarr files and retains source order and duplicates. Tracks for which Lidarr does not provide a downloaded file path are skipped. Persisted path mappings translate paths such as `/music` to `/mnt/media/music`.

The import page displays the output file, downloaded count, and missing count.

## CSV compatibility and reporting

CSV is an interchange and debugging format, not application state. From the GUI you can:

- import an existing `*_musicbrainz.csv` mapping;
- export mapping and unresolved reports;
- export matched/missing Lidarr reports;
- export artist impact and Lidarr action reports.

Existing report headers remain compatible; new metadata fields are appended where applicable.

## Launcher

The normal interface is now:

```bash
uv run music-import
uv run music-import --debug
```

Former switches such as `--overview`, `--resume`, `--dry-run`, `--missing-in-lidarr`, M3U source selection, output selection, and path mappings are represented by persistent GUI workflows and settings. CSV mapping import remains available from **New Import**.

## Tests

```bash
uv run python -m unittest discover -s tests -v
```

The test suite primarily targets application/domain behavior: resolver safeguards, persistent overrides and restart behavior, read-only planning, approved execution and idempotency, Lidarr safety rules, CSV migration, library state, and ordered duplicate-preserving M3U generation.

## Development

Install the locked development environment and run all local checks with:

```bash
uv sync --locked --dev
uv run ruff format --check src tests scripts
uv run ruff check src tests scripts
uv run python -m unittest discover -s tests -v
uv build
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.7
```

Use `uv run ruff format src tests scripts` to format changes. Install the repository Git hooks with
`uv run pre-commit install --hook-type pre-commit --hook-type commit-msg --hook-type pre-push`.
Tests use the standard-library `unittest`
framework and live in `tests/`, grouped by the module or behavior they protect. See
[`CONTRIBUTING.md`](CONTRIBUTING.md) for contribution expectations.

## Security and publication

The application handles API keys and OAuth session files. Keep `.env`, `.secrets/`, `.data/`, and
generated container data untracked; the supplied ignore files already exclude them. The web UI has
no application-level authentication or TLS and must remain localhost-only or behind a trusted,
authenticated reverse proxy. Before publishing a pre-existing repository, inspect its Git history
for credentials even when the current working tree is clean.
