import { redirect } from 'next/navigation';

export default async function ImportWorkspacePage({
  params,
}: {
  params: Promise<{ importId: string }>;
}) {
  const { importId } = await params;
  redirect(`/imports/${encodeURIComponent(importId)}/matching`);
}
