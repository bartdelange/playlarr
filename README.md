# Playlarr

## Playlists to Lidarr

**Playlarr brings your playlists home.**

Import playlists from music subscription services such as Spotify and TIDAL, match their tracks
against MusicBrainz, send the corresponding releases to Lidarr, and generate ordered M3U8 playlists
for your local music server.

Already have tracks in Navidrome that were not part of the original playlist? Playlarr can add
those too.

> Point Playlarr at a streaming playlist, let Lidarr build the local library, and recreate the
> playlist using your own music files.

<!-- TODO: Screenshot — Playlarr dashboard / import overview -->

Playlarr coordinates metadata and your existing services; it does not download music itself. Use it
only with media you are legally entitled to acquire and access. See [Responsible use](#responsible-use)
for the complete disclaimer.

## What can Playlarr do?

- Import playlists from Spotify and TIDAL.
- Resolve tracks to MusicBrainz recordings and releases.
- Pause for manual review when a match is uncertain and let you fix it.
- Preview every proposed Lidarr change before applying anything.
- Ask Lidarr to add, monitor, and search for the required releases.
- Preserve source order, moved tracks, and duplicate occurrences.
- Add optional Navidrome-only tracks to the finished playlist.
- Generate ordered M3U8 playlists using downloaded local files.
- Refresh an import later and show what was added, removed, moved, or changed.
- Retain imports, mappings, manual decisions, progress, and history across restarts.

## How it works

```text
Spotify / TIDAL
       │
       ▼
    Playlarr
       │
       ├── MusicBrainz ── identify tracks and releases
       │
       ▼
     Lidarr ───────────── acquire missing music
       │
       ▼
 Local music library
       │
       ├── Navidrome ──── optional local additions
       │
       ▼
   M3U8 playlist
```

Playlarr handles playlist metadata, matching, Lidarr planning, progress tracking, and playlist
generation. Lidarr remains responsible for acquiring and organizing music. Planning is read-only:
Playlarr changes Lidarr only after you inspect a plan and select **Apply to Lidarr**.

## Installing Playlarr

The web UI listens on port `8787`. It has no built-in login or TLS, so expose it only on a trusted
LAN or place it behind an authenticated reverse proxy.

### Unraid

Unraid is the primary supported installation path. The repository includes
[`playlarr.xml`](playlarr.xml), a native Unraid Docker template using:

```text
ghcr.io/bartdelange/playlists-to-lidarr:latest
```

1. Copy `playlarr.xml` to:

   ```text
   /boot/config/plugins/dockerMan/templates-user/my-playlarr.xml
   ```

2. Refresh the Unraid Docker page.
3. Select **Add Container**.
4. Choose `playlarr` under **User templates**.
5. Fill in the service settings and create the container.
6. Open `http://UNRAID-IP:8787`.

<!-- TODO: Screenshot — Unraid Playlarr template / configuration -->

The template uses two mounts:

- `/config` stores the SQLite workflow database and Spotify/TIDAL authentication state.
- `/playlists` stores generated M3U8 playlists and diagnostic reports.

The template deliberately retains `/mnt/user/appdata/tidal-to-lidarr` as its default `/config` host
path so installations created before the Playlarr rename continue to see their existing data. Do
not casually change that path when upgrading.

The image runs as UID/GID `1000:1000` and prepares both mount roots on startup. If you prefer to
prepare the host directories yourself:

```bash
mkdir -p /mnt/user/appdata/tidal-to-lidarr /mnt/user/music/playlists
chown -R 1000:1000 /mnt/user/appdata/tidal-to-lidarr
```

The template follows `latest`. For controlled upgrades, pin the Repository field to a published
version such as `ghcr.io/bartdelange/playlists-to-lidarr:2.0.0`.

### Docker Compose

The included [`compose.yaml`](compose.yaml) builds Playlarr locally using the repository's verified
environment and mounts:

```bash
git clone https://github.com/bartdelange/playlists-to-lidarr.git
cd playlists-to-lidarr
cp .env.example .env
mkdir -p container-config container-playlists
docker compose up -d --build
```

Set a real `MUSICBRAINZ_USER_AGENT` in `.env` before starting. Then open
`http://127.0.0.1:8787`, or replace the host with your Docker server's LAN address.

Check the container with:

```bash
docker compose ps
docker compose logs -f playlarr
```

The health endpoint is available at `/health`.

For an Unraid Compose stack, use persistent shares while retaining the compatibility-sensitive
appdata path:

```yaml
volumes:
  - /mnt/user/appdata/tidal-to-lidarr:/config
  - /mnt/user/music:/playlists
```

## First-time setup

Open **Settings** in the Playlarr web UI and configure the services you use:

- **MusicBrainz** identifies source tracks and maps them to releases Lidarr understands. Supply an
  identifying User-Agent containing a real contact email address or URL.
- **Spotify** needs a client ID and browser authentication. No client secret is required.
- **TIDAL** uses its device-login flow and saves the resulting session.
- **Lidarr** needs its URL, API key, root folder, quality profile, and metadata profile. Use
  **Test Lidarr** after saving.
- **Navidrome** is optional and is used only to search for local tracks to append during export. Use
  **Test Navidrome** after saving.

Use **Authenticate Spotify** or **Authenticate TIDAL** from Settings when that source is needed.
Secrets are replacement-only: Playlarr never renders saved passwords, API keys, or tokens back into
the page.

<!-- TODO: Screenshot — Playlarr Settings with service configuration -->

## Import your first playlist

1. Select **New Import** and choose Spotify or TIDAL.
2. Browse or filter your playlists and select the one you want to import.
3. Let Playlarr analyze and resolve its tracks through MusicBrainz.
4. Select **Review** for unresolved or uncertain tracks and correct them where needed.
5. Open the Lidarr plan and inspect the track-to-release mapping and every proposed action.
6. Select **Apply to Lidarr** when the plan is correct.
7. Give Lidarr time to acquire the requested music.
8. Select **Refresh monitored & downloaded** to update Playlarr's local-library status.
9. Optionally open **Local additions** and append Navidrome-only tracks.
10. Select **Export M3U** to generate the ordered playlist.

<!-- TODO: Screenshot — playlist browser and playlist selection -->

<!-- TODO: Screenshot — MusicBrainz matching / unresolved-track review -->

<!-- TODO: Screenshot — Lidarr plan and proposed actions -->

<!-- TODO: Screenshot — completed import and generated M3U8 playlist -->

Long-running catalogue reads, resolution, planning, update previews, and library work run as
persisted background jobs. Their progress remains visible, and an interrupted job is recorded after
a restart rather than silently disappearing.

## Refreshing an imported playlist

Streaming playlists change. Select **Refresh playlist** from an existing import to fetch its current
contents. Playlarr presents a filterable preview containing:

- added tracks;
- removed tracks;
- moved tracks;
- metadata changes;
- unchanged tracks.

Nothing changes until you apply the preview. Stable source track IDs and exact ISRCs retain safe
automatic mappings and confirmed manual decisions where possible, including duplicate occurrences.
New tracks return to MusicBrainz resolution. Every applied refresh stores before-and-after snapshots
in the import's update history.

Playlarr can also **Reuse mappings** from another import when both tracks have the same non-empty
ISRC. You choose which proposed overrides to accept; stale Lidarr plans are superseded when accepted
mappings change the import.

## Documentation

### Advanced configuration

The complete supported environment-variable list and defaults live in [`.env.example`](.env.example).
The important service variables are:

- `MUSICBRAINZ_USER_AGENT` — required identifying contact information;
- `SPOTIFY_CLIENT_ID` — required for Spotify imports;
- `LIDARR_URL` and `LIDARR_API_KEY` — required for Lidarr operations;
- `NAVIDROME_URL`, `NAVIDROME_USERNAME`, and `NAVIDROME_PASSWORD` — optional local additions.

Local source checkouts default to `.data`, `output`, and `.secrets`. `DATA_DIR`, `OUTPUT_DIR`,
`TIDAL_SESSION_FILE`, and `SPOTIFY_TOKEN_CACHE` override those paths. Container images set them to
locations beneath `/config` and `/playlists`.

Values saved through Settings take precedence over `.env`, except explicit `DATA_DIR` and
`OUTPUT_DIR` deployment overrides. Debug logging is also enabled from Settings.

### Spotify authentication

Create a Spotify application and register the exact configured callback URI. It defaults to
`http://127.0.0.1:8787/callback`; a headless Unraid deployment should use the externally reachable
Playlarr URL ending in `/callback`.

Spotify uses Authorization Code with PKCE, so no client secret is needed. The callback must be
reachable from the browser performing authentication. Tokens default to
`.secrets/spotify-token.json` locally and `/config/secrets/spotify-token.json` in the container.
Background jobs use only a cached token and fail with an actionable authentication message instead
of starting an interactive flow.

### TIDAL authentication

TIDAL uses device login and reuses the saved session file. Playlist folders are traversed
recursively. The session defaults to `.secrets/tidal-session.json` locally and
`/config/secrets/tidal-session.json` in the container.

### Matching and Lidarr safety

Automatic MusicBrainz resolution uses:

- normalized ISRC lookup first;
- title and primary-artist search only as a fallback;
- guarded title-overlap and similarity thresholds;
- remix, edit, and version-marker protection;
- source-album-aware canonical release selection;
- rate limiting and temporary-failure retries.

Manual recording MBIDs are checked against artist, title, duration, ISRC, and release-group evidence
before acceptance. Confirmed manual mappings are durable and are not replaced by later automation
unless you explicitly clear them.

Lidarr synchronization is additive. It does not monitor unrelated albums, sets new-item monitoring
to `none`, never implicitly adds or changes Various Artists, reuses downloaded canonical releases,
recognizes recording IDs and guarded alternate-version title matches, and avoids repeating searches
when an approved plan is replayed. Execution always corresponds to an inspectable, approved plan.

### Playlist generation

M3U8 generation queries downloaded Lidarr files while retaining source order and duplicate
occurrences. It then resolves saved local additions against Navidrome and appends them in their
saved order. Missing Lidarr paths and unavailable Navidrome additions are skipped and counted as
missing.

Persisted path mappings translate library paths such as `/music` to a path visible to the playlist
consumer, such as `/mnt/media/music`. Relative paths returned by Navidrome remain relative. The
Final page displays the generated file path, exported-track count, and missing count.

### CSV compatibility and reporting

SQLite is Playlarr's primary state. CSV remains an interchange and diagnostic format. From the web
UI you can:

- import an existing `*_musicbrainz.csv` mapping;
- export mapping and unresolved reports;
- export matched and missing Lidarr reports;
- export artist-impact and Lidarr-action reports.

Existing report headers remain compatible; new metadata fields are appended where applicable.

### Migrating existing installations

Current containers use a single `/config` appdata mount:

- `/config/data` contains `music-importer.db` and resumable workflow state;
- `/config/secrets` contains Spotify and TIDAL authentication state.

If an older installation still has separate `/data` and `/secrets` mounts, stop the container, move
the old `/data` contents into `<config-host-path>/data`, move the old `/secrets` contents into
`<config-host-path>/secrets`, replace both mounts with the single `/config` mount, and then start
the updated container.

For a previous local installation, copy `.data/music-importer.db` to
`<config-host-path>/data/music-importer.db`. Keep the existing
`/mnt/user/appdata/tidal-to-lidarr` host directory unless you intentionally migrate it while the
container is stopped.

### Architecture

The `music_importer` package is organized by capability:

- `app/` owns container startup;
- `web/` owns FastAPI composition, routes, templates, and static assets;
- `application/` and `workflows/` own source-neutral use cases and coordination;
- `domain/` owns provider-independent playlist records and rules;
- `integrations/` isolates Spotify, TIDAL, MusicBrainz, Lidarr, and Navidrome details;
- `persistence/` owns SQLite migrations and durable repositories;
- `exports/` owns CSV compatibility, reports, and M3U serialization.

SQLite stores imports, ordered source occurrences, resolution evidence, manual decisions, Lidarr
plans and execution results, jobs, library state, playlist revisions, local additions, and export
history. CSV and M3U8 files are outputs rather than primary state, except for the explicit legacy
CSV import path.

### Local development

Playlarr is a web-only application with no installed CLI. Run it locally with Python 3.12+ and
[`uv`](https://docs.astral.sh/uv/):

```bash
uv sync --locked --dev
cp .env.example .env
uv run uvicorn music_importer.web.app:create_app --factory --host 127.0.0.1 --port 8787
```

See [CONTRIBUTING.md](CONTRIBUTING.md) before making changes. Install the repository hooks with:

```bash
uv run pre-commit install --hook-type pre-commit --hook-type commit-msg --hook-type pre-push
```

### Tests

Run the complete local validation suite with:

```bash
uv run ruff format --check src tests scripts
uv run ruff check src tests scripts
uv run python -m unittest discover -s tests -v
uv build
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.7
```

The tests protect matching safeguards, persistence and migration, source parsing, ordered
duplicates, read-only planning, approved execution, cancellation, playlist refreshes, local
additions, library state, and M3U generation. Automated tests use mocks and require no live-service
credentials.

### Releases

Maintainers prepare an annotated semantic-version release with:

```bash
uv run python scripts/release.py prepare patch  # or minor / major
```

After merging the generated release PR, update local `master` and publish it:

```bash
git switch master
git pull --ff-only
uv run python scripts/release.py publish
```

The guarded helper updates `pyproject.toml` and `uv.lock`, validates the project, opens the release
PR, and refuses to move or reuse an existing tag. The release workflow verifies the tag, publishes
the versioned and `latest` `linux/amd64` images to GHCR with provenance, and creates the GitHub
release.

### Security and publication

Playlarr handles API keys and OAuth sessions. Never commit `.env`, `.secrets/`, `.data/`, OAuth
sessions, API keys, generated reports, or container data. The supplied ignore files already exclude
them. The web UI has no application-level authentication or TLS and must remain on a trusted network
or behind a trusted, authenticated reverse proxy.

Before publishing a pre-existing repository, inspect its complete Git history for credentials even
when the current working tree is clean. A license has intentionally not been selected; do not add
one without maintainer approval.

## Responsible use

**Use Playlarr responsibly.** Playlarr connects playlist metadata from services such as Spotify and
TIDAL to a user-controlled Lidarr installation. It does not supply music, rip audio, bypass DRM, or
grant permission to download copyrighted material.

The project does not condone piracy or any illegal ripping, copying, or downloading. Only acquire
and use media you are legally entitled to access, and comply with applicable laws, copyright
licenses, and each service's terms. You are solely responsible for how you configure and use
Playlarr and the external services connected to it.

Playlarr is not affiliated with Spotify, TIDAL, MusicBrainz, Lidarr, or Navidrome.
