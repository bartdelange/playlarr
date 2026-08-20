import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { database } from "../../../server/runtime";
import { ImportRepository } from "../../../server/persistence/import-repository";
export default function ImportsPage() {
  return (
    <main>
      <h1>Playlist imports</h1>
      <Link className="button" href="/imports/new">
        Add playlist
      </Link>
      <Suspense fallback={<ImportsSkeleton />}>
        <ImportsList />
      </Suspense>
    </main>
  );
}

async function ImportsList() {
  await connection();
  const imports = new ImportRepository(database).listImports();
  return (
    <div className="card-list">
      {imports.map((item) => (
        <Link className="card" key={item.id} href={`/imports/${item.id}`}>
          <span className="badge">{item.source}</span>
          <strong>{item.playlistName}</strong>
          <small>{item.workflowState.replaceAll("_", " ")}</small>
        </Link>
      ))}
    </div>
  );
}

function ImportsSkeleton() {
  return <div className="card skeleton">Loading playlist imports…</div>;
}
