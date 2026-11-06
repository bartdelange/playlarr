import type { ImportSummary } from '@playlarr/imports-contracts';
import { getSpotifyImports } from '@playlarr/spotify-web/server';
import { getTidalImports } from '@playlarr/tidal-web/server';

import styles from './import-dashboard.module.css';

function importHref(imported: ImportSummary): string {
  return imported.source === 'spotify'
    ? `/imports/${imported.id}`
    : `/imports/${imported.id}/tidal`;
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
            <dt>MusicBrainz</dt>
            <dd>Not started</dd>
          </div>
          <div>
            <dt>Lidarr</dt>
            <dd>Waiting for matching</dd>
          </div>
          <div>
            <dt>Library</dt>
            <dd>Not started</dd>
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
  const imports = (await Promise.all([getSpotifyImports(), getTidalImports()]))
    .flat()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

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

      {imports.length === 0 ? (
        <section className={styles.empty}>
          <h2>No imported playlists yet</h2>
          <p>Import a playlist from Spotify or TIDAL to get started.</p>
          <a href="/imports/new">Import a playlist</a>
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
