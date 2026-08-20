import { queueLibraryStatus } from "../../../actions/exports";
import { requestCsrfToken } from "../../../../server/security/request";
import { ImportRepository } from "../../../../server/persistence/import-repository";
import { database } from "../../../../server/runtime";
import { ActiveNav } from "../../../../components/navigation/active-nav";

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
      <div className="import-nav-shell">
        <ActiveNav
          className="import-nav"
          label="Import navigation"
          items={[
            { href: `/imports/${id}`, label: "Overview", exact: true },
            { href: `/imports/${id}/revisions`, label: "History" },
            {
              href: `/imports/${id}/mapping-overrides`,
              label: "Reuse mappings",
            },
            {
              href: `/imports/${id}/local-additions`,
              label: "Local additions",
            },
          ]}
        />
        {[
          "waiting_for_downloads",
          "library_status",
          "playlist_generated",
        ].includes(state) && (
          <form action={queueLibraryStatus}>
            <input type="hidden" name="csrf_token" value={csrf} />
            <input type="hidden" name="import_id" value={id} />
            <button className="secondary">Refresh library files</button>
          </form>
        )}
      </div>
      {children}
    </>
  );
}
