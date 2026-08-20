import Link from "next/link";

export default async function ImportWorkflowLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <><nav className="workflow-nav" aria-label="Playlist workflow"><Link href={`/imports/${id}`}>Overview</Link><Link href={`/imports/${id}/revisions`}>History</Link><Link href={`/imports/${id}/mapping-overrides`}>Reuse mappings</Link><Link href={`/imports/${id}/local-additions`}>Local additions</Link></nav>{children}</>;
}
