import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { PlaylistRevisionRepository } from "../../../../../server/persistence/playlist-revision-repository";
import { database } from "../../../../../server/runtime";
export default function RevisionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <main>
      <h1>Playlist revisions</h1>
      <Suspense fallback={<RevisionsSkeleton />}>
        <RevisionList params={params} />
      </Suspense>
    </main>
  );
}

async function RevisionList({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const revisions = new PlaylistRevisionRepository(database).list(id);
  return (
    <>
      {revisions.map((revision) => (
        <Link
          className="card"
          href={`/imports/${id}/revisions/${revision.id}`}
          key={revision.id}
        >
          <strong>
            {revision.added} added · {revision.removed} removed ·{" "}
            {revision.updated} updated
          </strong>
          <small>
            {revision.moved} moved · {revision.unchanged} unchanged
          </small>
        </Link>
      ))}
    </>
  );
}

function RevisionsSkeleton() {
  return <section className="card skeleton">Loading revision history…</section>;
}
