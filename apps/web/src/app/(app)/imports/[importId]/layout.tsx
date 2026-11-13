import { ImportWorkspace } from '@playlarr/imports-web';
import { ImportActivity } from '@playlarr/imports-web/activity';
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
      activity={<ImportActivity importId={imported.id} key={imported.id} />}
      imported={imported}
      navigation={<ImportWorkspaceNavigation importId={imported.id} />}
    >
      {children}
    </ImportWorkspace>
  );
}
