import { connection } from "next/server";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { AcquiredTrack } from "../../../../../server/domain/playlist";
import { previewPlaylistUpdate } from "../../../../../server/domain/playlist-updates";
import { ImportRepository } from "../../../../../server/persistence/import-repository";
import { JobRepository } from "../../../../../server/persistence/job-repository";
import { database } from "../../../../../server/runtime";
import { requestCsrfToken } from "../../../../../server/security/request";
import { applyPlaylistUpdate } from "../../../../actions/workflows";
import { PlaylistUpdateTable } from "../../../../../components/imports/playlist-update-table";
import Link from "next/link";

export default function PlaylistUpdatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ preview_job?: string }>;
}) {
  return (
    <main>
      <p className="eyebrow">Playlist update</p>
      <Suspense fallback={<PlaylistUpdateSkeleton />}>
        <PlaylistUpdateContent params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function PlaylistUpdateContent({
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
  const entries = preview.payload.entries as AcquiredTrack[];
  const snapshotToken = String(preview.payload.snapshotToken ?? "");
  const update = previewPlaylistUpdate(imports.entries(id), entries);
  const csrf = await requestCsrfToken();

  return (
    <>
      <p className="eyebrow">{imported.source} playlist update</p>
      <h1>Review changes to {imported.playlistName}</h1>
      <section className="card">
        <h2>Proposed update</h2>
        <p>
          <strong>{update.added}</strong> added · <strong>{update.updated}</strong> updated ·{" "}
          <strong>{update.removed}</strong> removed · <strong>{update.moved}</strong> moved ·{" "}
          <strong>{update.unchanged}</strong> unchanged
        </p>
        <p>
          Existing matches and manual corrections are retained for tracks matched by source track ID or ISRC. Added
          tracks will wait for resolution. Removed tracks remain available in the update audit snapshot.
        </p>
        <div className="actions">
          {update.added || update.removed || update.updated || update.moved ? (
            <form action={applyPlaylistUpdate}>
              <input type="hidden" name="csrf_token" value={csrf} />
              <input type="hidden" name="import_id" value={id} />
              <input type="hidden" name="preview_job" value={preview.id} />
              <input type="hidden" name="snapshot_token" value={snapshotToken} />
              <button>Apply update</button>
            </form>
          ) : (
            <span className="status ok">Already up to date</span>
          )}
          <Link className="button secondary" href={`/imports/${id}`}>
            Cancel
          </Link>
        </div>
      </section>
      <PlaylistUpdateTable update={update} />
    </>
  );
}

function PlaylistUpdateSkeleton() {
  return <section className="card skeleton">Loading update preview…</section>;
}
