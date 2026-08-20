import { connection } from "next/server";
import { notFound } from "next/navigation";
import { ImportRepository } from "../../../../../server/persistence/import-repository";
import { MappingOverridesRepository } from "../../../../../server/persistence/mapping-overrides-repository";
import { database } from "../../../../../server/runtime";
import { requestCsrfToken } from "../../../../../server/security/request";
import { applyMappingOverrides } from "../../../../actions/workflows";

const labels = {
  conflict: "Conflicting source mappings",
  already_same: "Accepted and ignored",
  will_override: "Overrides existing",
  will_map: "Ready to reuse",
};
export default async function MappingOverridesPage({
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
  const candidates = sourceId
    ? new MappingOverridesRepository(database).candidates(id, sourceId)
    : [];
  const csrf = await requestCsrfToken();
  return (
    <main>
      <p className="eyebrow">Reuse confirmed matches</p>
      <h1>{imported.playlistName}</h1>
      <p>
        Only exact ISRC matches can be copied. Conflicting source mappings are
        never selectable.
      </p>
      <form method="get">
        <label>
          Source playlist
          <select
            name="source_import_id"
            defaultValue={sourceId ?? ""}
            required
          >
            <option value="">Choose a playlist</option>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.playlistName}
              </option>
            ))}
          </select>
        </label>
        <button>Preview matches</button>
      </form>
      {sourceId && (
        <form action={applyMappingOverrides}>
          <input type="hidden" name="csrf_token" value={csrf} />
          <input type="hidden" name="import_id" value={id} />
          <input type="hidden" name="source_import_id" value={sourceId} />
          <div className="card-list">
            {candidates.map((candidate) => (
              <label className="card" key={candidate.target.id}>
                <span>
                  <input
                    type="checkbox"
                    name="target_entry_ids"
                    value={candidate.target.id}
                    disabled={
                      !["will_map", "will_override"].includes(candidate.status)
                    }
                  />{" "}
                  {labels[candidate.status]}
                </span>
                <strong>{candidate.target.track.title}</strong>
                <small>
                  {String(
                    candidate.sourceResult.recordingTitle ??
                      candidate.source.track.title,
                  )}{" "}
                  · ISRC {candidate.target.track.isrc}
                </small>
              </label>
            ))}
          </div>
          {candidates.some((item) =>
            ["will_map", "will_override"].includes(item.status),
          ) && <button>Apply selected mappings</button>}
        </form>
      )}
    </main>
  );
}
