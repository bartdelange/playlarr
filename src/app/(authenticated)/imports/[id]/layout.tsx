import Link from "next/link";
import { queueLibraryStatus } from "../../../actions/exports";
import { requestCsrfToken } from "../../../../server/security/request";

export default async function ImportWorkflowLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params; const csrf = await requestCsrfToken();
  return <><nav className="workflow-nav" aria-label="Playlist workflow"><Link href={`/imports/${id}`}>Overview</Link><Link href={`/imports/${id}/revisions`}>History</Link><Link href={`/imports/${id}/mapping-overrides`}>Reuse mappings</Link><Link href={`/imports/${id}/local-additions`}>Local additions</Link><form action={queueLibraryStatus}><input type="hidden" name="csrf_token" value={csrf} /><input type="hidden" name="import_id" value={id} /><button className="secondary">Refresh library files</button></form></nav>{children}</>;
}
