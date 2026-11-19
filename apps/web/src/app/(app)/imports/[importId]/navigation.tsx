'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import styles from './navigation.module.css';

const stages = [
  { path: 'matching', label: 'Music Matching' },
  { path: 'lidarr', label: 'Lidarr' },
  { path: 'library', label: 'Library' },
] as const;

export function ImportWorkspaceNavigation({ importId }: { importId: string }) {
  const pathname = usePathname();
  const basePath = `/imports/${encodeURIComponent(importId)}`;

  return (
    <nav aria-label="Import stages" className={styles.navigation}>
      {stages.map((stage) => {
        const href = `${basePath}/${stage.path}`;
        const active = pathname === href;

        return (
          <Link
            aria-current={active ? 'page' : undefined}
            href={href}
            key={stage.path}
          >
            {stage.label}
          </Link>
        );
      })}
    </nav>
  );
}
