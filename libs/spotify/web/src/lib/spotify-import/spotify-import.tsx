'use client';

import { useState } from 'react';
import {
  spotifyImportSchema,
  type SourcePlaylist,
  type SpotifyImport,
} from '@playlarr/spotify-contracts';

import styles from './spotify-import.module.css';

export function NewImportSources() {
  return (
    <main className={styles.flow}>
      <h1>New import</h1>
      <p>Choose where to import a playlist from.</p>
      <a className={styles.source} href="/imports/new?source=spotify">
        <strong>Spotify</strong>
        <span>Browse playlists from your connected Spotify account.</span>
      </a>
    </main>
  );
}

export function SpotifyAuthorizationRequired({
  configured,
}: {
  configured: boolean;
}) {
  const returnTo = encodeURIComponent('/imports/new?source=spotify');
  return (
    <main className={styles.flow}>
      <h1>Choose a Spotify playlist</h1>
      <div className={styles.notice} role="status">
        <p>
          {configured
            ? 'Connect Spotify to browse your playlists.'
            : 'Configure Spotify before starting an import.'}
        </p>
        <a
          href={
            configured
              ? `/api/spotify/authorize?returnTo=${returnTo}`
              : '/settings'
          }
        >
          {configured ? 'Authorize Spotify' : 'Open Spotify settings'}
        </a>
      </div>
    </main>
  );
}

export function SpotifyPlaylistSelection({
  playlists,
}: {
  playlists: SourcePlaylist[];
}) {
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authorizationRequired, setAuthorizationRequired] = useState(false);

  async function select(playlistId: string) {
    setCreating(playlistId);
    setError(null);
    setAuthorizationRequired(false);
    try {
      const response = await fetch('/api/spotify/imports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playlistId }),
      });
      if (response.status === 401) {
        setAuthorizationRequired(true);
        setCreating(null);
        return;
      }
      if (!response.ok) throw new Error();
      const parsed = spotifyImportSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error();
      window.location.assign(`/imports/${parsed.data.id}`);
    } catch {
      setError('Unable to import this playlist. Please try again.');
      setCreating(null);
    }
  }

  return (
    <main className={styles.flow}>
      <h1>Choose a Spotify playlist</h1>
      <p>Select a playlist to create an import and open its workspace.</p>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {authorizationRequired ? (
        <div className={styles.notice} role="alert">
          <p>Spotify authorization is no longer valid.</p>
          <a href="/api/spotify/authorize?returnTo=%2Fimports%2Fnew%3Fsource%3Dspotify">
            Authorize Spotify
          </a>
        </div>
      ) : null}
      {playlists.length === 0 ? (
        <div className={styles.notice}>
          <p>No Spotify playlists were found.</p>
          <a href="/imports/new">Choose another source</a>
        </div>
      ) : (
        <ul className={styles.playlists}>
          {playlists.map((playlist) => (
            <li key={playlist.id}>
              <div>
                <strong>{playlist.name}</strong>
                <span>
                  {playlist.owner.displayName ?? playlist.owner.id} ·{' '}
                  {playlist.itemCount}{' '}
                  {playlist.itemCount === 1 ? 'item' : 'items'}
                </span>
              </div>
              <button
                disabled={creating !== null}
                onClick={() => void select(playlist.id)}
                type="button"
              >
                {creating === playlist.id ? 'Creating import…' : 'Import'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

export function SpotifyImportWorkspace({
  imported,
}: {
  imported: SpotifyImport;
}) {
  return (
    <main className={styles.flow}>
      <p className={styles.eyebrow}>Spotify import</p>
      <h1>{imported.playlist.name}</h1>
      <p>
        {imported.tracks.length} source{' '}
        {imported.tracks.length === 1 ? 'item' : 'items'} in playlist order
      </p>
      <ol className={styles.tracks}>
        {imported.tracks.map((track) => (
          <li key={track.position}>
            {track.status === 'available' ? (
              <>
                <strong>{track.name}</strong>
                <span>
                  {track.artists.join(', ')} · {track.album}
                </span>
              </>
            ) : (
              <>
                <strong>Unavailable source item</strong>
                <span>{track.status}</span>
              </>
            )}
          </li>
        ))}
      </ol>
    </main>
  );
}
