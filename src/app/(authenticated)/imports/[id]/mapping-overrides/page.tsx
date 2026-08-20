import { connection } from "next/server";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { MappingOverridesTable } from "../../../../../components/imports/mapping-overrides-table";
import { ImportRepository } from "../../../../../server/persistence/import-repository";
import { MappingOverridesRepository } from "../../../../../server/persistence/mapping-overrides-repository";
import { database } from "../../../../../server/runtime";
import { requestCsrfToken } from "../../../../../server/security/request";
import { applyMappingOverrides } from "../../../../actions/workflows";

export default function MappingOverridesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ source_import_id?: string }>;
}) {
  return (
    <main>
      <p className="eyebrow">Bulk mapping reuse</p>
      <Suspense fallback={<MappingOverridesSkeleton />}>
        <MappingOverridesContent params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function MappingOverridesContent({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ source_import_id?: string }>;
}) {
  await connection();
  const { id } = await params;
  const { source_import_id: sourceId } = await searchParams;
  const imports = new ImportRepository(database);
  let imported;
  try {
    imported = imports.getImport(id);
  } catch {
    notFound();
  }
  const sources = imports.listImports().filter((item) => item.id !== id);
  const selectedSource = sourceId
    ? sources.find((source) => source.id === sourceId)
    : undefined;
  const candidates = selectedSource
    ? new MappingOverridesRepository(database).candidates(id, selectedSource.id)
    : [];
  const csrf = await requestCsrfToken();

  return (
    <>
      <h1>Reuse mappings in {imported.playlistName}</h1>
      <section className="card">
        <h2>Choose a source import</h2>
        <p>
          Only exact, non-empty ISRC matches are considered. Nothing changes
          until you review and apply the selected rows.
        </p>
        <form method="get">
          <select
            name="source_import_id"
            defaultValue={sourceId ?? ""}
            required
          >
            <option value="">Select an import…</option>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.playlistName} · {source.source}
              </option>
            ))}
          </select>
          <button>Compare mappings</button>
        </form>
      </section>
      {selectedSource && (
        <MappingOverridesTable
          candidates={candidates}
          importId={id}
          sourceImportId={selectedSource.id}
          sourceName={selectedSource.playlistName}
          csrf={csrf}
          action={applyMappingOverrides}
        />
      )}
    </>
  );
}

function MappingOverridesSkeleton() {
  return (
    <section className="card skeleton">Loading mapping candidates…</section>
  );
}
