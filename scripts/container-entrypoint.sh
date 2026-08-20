#!/bin/bash
set -euo pipefail

mkdir -p /config/data /config/secrets /playlists
chown -R node:node /config /playlists

export TIDAL_SESSION_FILE="${TIDAL_SESSION_FILE:-/config/secrets/tidal-session.json}"
export SPOTIFY_TOKEN_CACHE="${SPOTIFY_TOKEN_CACHE:-/config/secrets/spotify-token.json}"

shutdown() {
  kill -TERM "${web_pid:-}" "${worker_pid:-}" 2>/dev/null || true
  wait "${web_pid:-}" "${worker_pid:-}" 2>/dev/null || true
}

trap shutdown TERM INT

gosu node ./node_modules/.bin/tsx src/server/jobs/main.ts &
worker_pid=$!
gosu node node server.js &
web_pid=$!

wait -n "$web_pid" "$worker_pid"
status=$?
shutdown
exit "$status"
