import styles from './new-import.module.css';

export function NewImportSources() {
  return (
    <main className={styles.flow}>
      <h1>New import</h1>
      <p>Choose where to import a playlist from.</p>
      <a className={styles.source} href="/imports/new?source=spotify">
        <strong>Spotify</strong>
        <span>Browse playlists from your connected Spotify account.</span>
      </a>
      <a className={styles.source} href="/imports/new?source=tidal">
        <strong>TIDAL</strong>
        <span>Browse playlists from your connected TIDAL account.</span>
      </a>
    </main>
  );
}
