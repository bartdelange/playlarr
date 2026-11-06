import { TidalImportWorkspace } from '@playlarr/tidal-web';
import { getTidalImport } from '@playlarr/tidal-web/server';

export default async function TidalImportWorkspacePage({
  params,
}: {
  params: Promise<{ importId: string }>;
}) {
  const { importId } = await params;
  return <TidalImportWorkspace imported={await getTidalImport(importId)} />;
}
