import type { ReactNode } from 'react';

import type { ImportWorkspaceContext } from './import-workspace.server.js';
import styles from './import-workspace.module.css';

export function ImportWorkspace({
  activity,
  children,
  imported,
  navigation,
}: {
  activity: ReactNode;
  children: ReactNode;
  imported: ImportWorkspaceContext;
  navigation: ReactNode;
}) {
  const needsReview = imported.unavailableTrackCount;

  return (
    <main className={styles.workspace}>
      <header className={styles.header}>
        <div>
          <p className={styles.source}>{imported.source} import</p>
          <h1>{imported.name}</h1>
          <p>
            {imported.trackCount}{' '}
            {imported.trackCount === 1 ? 'track' : 'tracks'}
            {needsReview > 0
              ? ` · ${needsReview} ${needsReview === 1 ? 'item needs' : 'items need'} review`
              : ' · Ready for matching'}
          </p>
        </div>
        <aside className={styles.activity}>
          <strong>Activity</strong>
          {activity}
        </aside>
      </header>

      {navigation}
      <section className={styles.stage}>{children}</section>
    </main>
  );
}

export function ImportStagePlaceholder({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <div className={styles.placeholder}>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}

export function ImportWorkspaceSkeleton() {
  return (
    <main aria-busy="true" className={styles.workspace}>
      <header className={styles.header}>
        <div>
          <p className={styles.source}>Import workspace</p>
          <h1>Loading import…</h1>
        </div>
      </header>
      <p role="status">Loading import workspace…</p>
    </main>
  );
}
