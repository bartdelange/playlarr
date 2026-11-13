import type { ImportSummary } from '@playlarr/imports-contracts';
import { getSpotifyImports } from '@playlarr/spotify-web/server';
import { getTidalImports } from '@playlarr/tidal-web/server';

import styles from './import-dashboard.module.css';

function importHref(imported: ImportSummary): string {
  return `/imports/${imported.id}`;
}

function ImportCard({ imported }: { imported: ImportSummary }) {
  const source = imported.source === 'spotify' ? 'Spotify' : 'TIDAL';
  const importedAt = new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(imported.createdAt));

  return (
    <li>
      <a className={styles.card} href={importHref(imported)}>
        <div className={styles.cardHeading}>
          <div>
            <span className={styles.source}>{source}</span>
            <h2>{imported.name}</h2>
          </div>
          <span className={styles.attention}>Matching required</span>
        </div>

        <dl className={styles.statuses}>
          <div>
            <dt>Tracks</dt>
            <dd>{imported.trackCount}</dd>
          </div>
          <div>
            <dt>Workflow</dt>
            <dd>Ready for matching</dd>
          </div>
        </dl>

        <div className={styles.activity}>
          <span>Imported {importedAt} UTC</span>
          {imported.unavailableTrackCount > 0 ? (
            <strong>
              {imported.unavailableTrackCount}{' '}
              {imported.unavailableTrackCount === 1 ? 'track' : 'tracks'} need
              review
            </strong>
          ) : null}
        </div>
      </a>
    </li>
  );
}

export async function ImportDashboard() {
  const [spotifyResult, tidalResult] = await Promise.allSettled([
    getSpotifyImports(),
    getTidalImports(),
  ]);
  const failedSources = [
    spotifyResult.status === 'rejected' ? 'Spotify' : null,
    tidalResult.status === 'rejected' ? 'TIDAL' : null,
  ].filter((source): source is string => source !== null);

  if (failedSources.length === 2) {
    throw new Error('Imported playlists are unavailable');
  }

  const imports = [
    ...(spotifyResult.status === 'fulfilled' ? spotifyResult.value : []),
    ...(tidalResult.status === 'fulfilled' ? tidalResult.value : []),
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  return (
    <main className={styles.dashboard}>
      <header className={styles.header}>
        <div>
          <h1>Imported playlists</h1>
          <p>See what needs attention and continue working on an import.</p>
        </div>
        <a className={styles.newImport} href="/imports/new">
          New import
        </a>
      </header>

      {failedSources.length > 0 ? (
        <p className={styles.partialError} role="alert">
          {failedSources.join(' and ')} imports could not be loaded. Showing the
          local imports that are available.
        </p>
      ) : null}

      {imports.length === 0 ? (
        <section className={styles.empty}>
          <h2>
            {failedSources.length > 0
              ? 'No imported playlists available to show'
              : 'No imported playlists yet'}
          </h2>
          {failedSources.length === 0 ? (
            <>
              <p>Import a playlist from Spotify or TIDAL to get started.</p>
              <a href="/imports/new">Import a playlist</a>
            </>
          ) : null}
        </section>
      ) : (
        <ul className={styles.grid}>
          {imports.map((imported) => (
            <ImportCard
              imported={imported}
              key={`${imported.source}:${imported.id}`}
            />
          ))}
        </ul>
      )}
    </main>
  );
}

export function ImportDashboardSkeleton() {
  return (
    <main className={styles.dashboard} aria-busy="true" aria-live="polite">
      <header className={styles.header}>
        <div>
          <h1>Imported playlists</h1>
          <p role="status">Loading imported playlists…</p>
        </div>
      </header>
      <div className={styles.skeleton} aria-hidden="true" />
    </main>
  );
}
