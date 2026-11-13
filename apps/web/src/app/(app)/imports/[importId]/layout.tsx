import { ImportWorkspace } from '@playlarr/imports-web';
import { getImportWorkspaceContext } from '@playlarr/imports-web/server';
import { notFound } from 'next/navigation';

import { ImportWorkspaceNavigation } from './navigation';

export default async function ImportWorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ importId: string }>;
}) {
  const { importId } = await params;
  const imported = await getImportWorkspaceContext(importId);

  if (imported === null) notFound();

  return (
    <ImportWorkspace
      imported={imported}
      navigation={<ImportWorkspaceNavigation importId={imported.id} />}
    >
      {children}
    </ImportWorkspace>
  );
}
