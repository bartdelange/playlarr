import Link from "next/link";
import { queueLibraryStatus } from "../../../actions/exports";
import { requestCsrfToken } from "../../../../server/security/request";
import { ImportRepository } from "../../../../server/persistence/import-repository";
import { database } from "../../../../server/runtime";

export default async function ImportWorkflowLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const csrf = await requestCsrfToken();
  const state = new ImportRepository(database).getImport(id).workflowState;
  return (
    <>
      <nav className="workflow-nav" aria-label="Playlist workflow">
        <Link href={`/imports/${id}`}>Overview</Link>
        <Link href={`/imports/${id}/revisions`}>History</Link>
        <Link href={`/imports/${id}/mapping-overrides`}>Reuse mappings</Link>
        <Link href={`/imports/${id}/local-additions`}>Local additions</Link>
        {["waiting_for_downloads", "library_status", "playlist_generated"].includes(state) && (
          <form action={queueLibraryStatus}>
            <input type="hidden" name="csrf_token" value={csrf} />
            <input type="hidden" name="import_id" value={id} />
            <button className="secondary">Refresh library files</button>
          </form>
        )}
      </nav>
      {children}
    </>
  );
}
