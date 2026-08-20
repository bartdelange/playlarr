import { connection } from "next/server";
import { notFound } from "next/navigation";
import type {
  AcquiredTrack,
  PlaylistInfo,
} from "../../../../../server/domain/playlist";
import { previewPlaylistUpdate } from "../../../../../server/domain/playlist-updates";
import { ImportRepository } from "../../../../../server/persistence/import-repository";
import { JobRepository } from "../../../../../server/persistence/job-repository";
import { database } from "../../../../../server/runtime";
import { requestCsrfToken } from "../../../../../server/security/request";
import { applyPlaylistUpdate } from "../../../../actions/workflows";

export default async function PlaylistUpdatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ preview_job?: string }>;
}) {
  await connection();
  const { id } = await params;
  const { preview_job: previewJobId } = await searchParams;
  if (!previewJobId) notFound();
  const imports = new ImportRepository(database);
  let imported;
  let preview;
  try {
    imported = imports.getImport(id);
    preview = new JobRepository(database).get(previewJobId);
  } catch {
    notFound();
  }
  if (
    preview.importId !== id ||
    preview.kind !== "playlist_update_preview" ||
    preview.status !== "completed" ||
    !preview.payload
  )
    notFound();
  const playlist = preview.payload.playlist as PlaylistInfo;
  const entries = preview.payload.entries as AcquiredTrack[];
  const snapshotToken = String(preview.payload.snapshotToken ?? "");
  const update = previewPlaylistUpdate(imports.entries(id), entries);
  const csrf = await requestCsrfToken();

  return (
    <main>
      <p className="eyebrow">Source update</p>
      <h1>{imported.playlistName}</h1>
      <p>
        The current source playlist is <strong>{playlist.name}</strong>. Review
        this immutable snapshot before applying it.
      </p>
      <div className="card-list">
        <article className="card">
          <strong>{update.added} added</strong>
          <span>{update.removed} removed</span>
          <small>
            {update.updated} metadata changes · {update.moved} moved ·{" "}
            {update.unchanged} unchanged
          </small>
        </article>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>State</th>
              <th>Old</th>
              <th>New</th>
              <th>Changed fields</th>
            </tr>
          </thead>
          <tbody>
            {update.changes.map((change, index) => (
              <tr key={index}>
                <td>{change.state}</td>
                <td>
                  {change.oldPosition === undefined
                    ? "—"
                    : change.oldPosition + 1}
                </td>
                <td>
                  {change.newPosition === undefined
                    ? "—"
                    : change.newPosition + 1}
                </td>
                <td>{change.changedFields.join(", ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form action={applyPlaylistUpdate}>
        <input type="hidden" name="csrf_token" value={csrf} />
        <input type="hidden" name="import_id" value={id} />
        <input type="hidden" name="preview_job" value={preview.id} />
        <input type="hidden" name="snapshot_token" value={snapshotToken} />
        <button>Apply approved update</button>
      </form>
    </main>
  );
}
