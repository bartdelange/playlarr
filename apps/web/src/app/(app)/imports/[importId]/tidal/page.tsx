import { redirect } from 'next/navigation';

export default async function LegacyTidalImportWorkspacePage({
  params,
}: {
  params: Promise<{ importId: string }>;
}) {
  const { importId } = await params;
  redirect(`/imports/${encodeURIComponent(importId)}/matching`);
}
