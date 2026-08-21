import { connection } from "next/server";
import { Suspense } from "react";
import { PlaylistRevisionRepository } from "../../../../../../server/persistence/playlist-revision-repository";
import { database } from "../../../../../../server/runtime";
import { ImportRepository } from "../../../../../../server/persistence/import-repository";
import Link from "next/link";

export default function RevisionPage({ params }: { params: Promise<{ id: string; revisionId: string }> }) {
  return (
    <main>
      <p className="eyebrow">Playlist update audit</p>
      <Suspense fallback={<RevisionSkeleton />}>
        <RevisionDetails params={params} />
      </Suspense>
    </main>
  );
}

async function RevisionDetails({ params }: { params: Promise<{ id: string; revisionId: string }> }) {
  await connection();
  const { id, revisionId } = await params;
  const revision = new PlaylistRevisionRepository(database).get(id, revisionId);
  const imported = new ImportRepository(database).getImport(id);
  return (
    <>
      <h1>{imported.playlistName}</h1>
      <section className="card">
        <p>
          <strong>{revision.createdAt}</strong> · {revision.added} added · {revision.updated} updated ·{" "}
          {revision.removed} removed · {revision.moved} moved · {revision.unchanged} unchanged
        </p>
        <Link className="button secondary" href={`/imports/${id}`}>
          Back to playlist
        </Link>
      </section>
      <div className="source-grid">
        <RevisionTracks title="Before" tracks={revision.before} />
        <RevisionTracks title="After" tracks={revision.after} />
      </div>
    </>
  );
}

function RevisionSkeleton() {
  return <section className="card skeleton">Loading revision details…</section>;
}

function RevisionTracks({
  title,
  tracks,
}: {
  title: string;
  tracks: ReturnType<PlaylistRevisionRepository["get"]>["before"];
}) {
  return (
    <section className="card">
      <h2>
        {title} · {tracks.length} tracks
      </h2>
      <ol>
        {tracks.map((track, index) => (
          <li key={`${track.sourceTrackId}-${index}`}>
            <strong>{track.title}</strong>
            <small>
              {track.artists.join(", ")} · position {track.position + 1}
            </small>
          </li>
        ))}
      </ol>
    </section>
  );
}
