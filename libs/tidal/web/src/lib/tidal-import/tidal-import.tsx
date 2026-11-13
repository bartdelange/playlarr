'use client';

import { useState } from 'react';
import {
  tidalImportSchema,
  type SourcePlaylist,
  type TidalImport,
} from '@playlarr/tidal-contracts';

import { TidalAuthorizationResult } from '../tidal-settings/tidal-settings.js';
import styles from './tidal-import.module.css';

const returnTo = encodeURIComponent('/imports/new?source=tidal');

export const tidalImportWorkspacePath = (importId: string) =>
  `/imports/${encodeURIComponent(importId)}`;

export function TidalAuthorizationRequired({
  configured,
  authorizationResult,
}: {
  configured: boolean;
  authorizationResult?: { status?: string; error?: string };
}) {
  return (
    <main className={styles.flow}>
      <h1>Choose a TIDAL playlist</h1>
      <TidalAuthorizationResult result={authorizationResult} />
      <div className={styles.notice} role="status">
        <p>
          {configured
            ? 'Connect TIDAL to browse your playlists.'
            : 'Configure TIDAL before starting an import.'}
        </p>
        <a
          href={
            configured
              ? `/api/tidal/authorize?returnTo=${returnTo}`
              : '/settings'
          }
        >
          {configured ? 'Authorize TIDAL' : 'Open TIDAL settings'}
        </a>
      </div>
    </main>
  );
}

export function TidalPlaylistSelection({
  playlists,
  authorizationResult,
}: {
  playlists: SourcePlaylist[];
  authorizationResult?: { status?: string; error?: string };
}) {
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authorizationRequired, setAuthorizationRequired] = useState(false);

  async function select(playlistId: string) {
    setCreating(playlistId);
    setError(null);
    setAuthorizationRequired(false);
    try {
      const response = await fetch('/api/tidal/imports', {
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
      const parsed = tidalImportSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error();
      window.location.assign(tidalImportWorkspacePath(parsed.data.id));
    } catch {
      setError('Unable to import this playlist. Please try again.');
      setCreating(null);
    }
  }

  return (
    <main className={styles.flow}>
      <h1>Choose a TIDAL playlist</h1>
      <p>Select a playlist to create an import and open its workspace.</p>
      <TidalAuthorizationResult result={authorizationResult} />
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {authorizationRequired ? (
        <div className={styles.notice} role="alert">
          <p>TIDAL authorization is no longer valid.</p>
          <a href={`/api/tidal/authorize?returnTo=${returnTo}`}>
            Authorize TIDAL
          </a>
        </div>
      ) : null}
      {playlists.length === 0 ? (
        <div className={styles.notice}>
          <p>No TIDAL playlists were found.</p>
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

export function TidalImportWorkspace({ imported }: { imported: TidalImport }) {
  return (
    <main className={styles.flow}>
      <p className={styles.eyebrow}>TIDAL import</p>
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
