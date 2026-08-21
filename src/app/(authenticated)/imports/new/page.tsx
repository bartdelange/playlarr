import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PlaylistCatalogue } from "../../../../components/imports/playlist-catalogue";
import type { PlaylistInfo } from "../../../../server/domain/playlist";
import { ImportRepository } from "../../../../server/persistence/import-repository";
import { JobRepository } from "../../../../server/persistence/job-repository";
import { LibraryRepository } from "../../../../server/persistence/library-repository";
import { requestCsrfToken } from "../../../../server/security/request";
import { database } from "../../../../server/runtime";
import { queuePlaylistAcquisition, queuePlaylistAnalysis, queuePlaylistCatalogue } from "../../../actions/workflows";

export default function NewImportPage({
  searchParams,
}: {
  searchParams: Promise<{
    source?: string;
    catalog_job?: string;
    error?: string;
  }>;
}) {
  return (
    <main>
      <p className="eyebrow">New import</p>
      <h1>Choose a source</h1>
      <Suspense fallback={<NewImportSkeleton />}>
        <NewImportContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function NewImportContent({
  searchParams,
}: {
  searchParams: Promise<{
    source?: string;
    catalog_job?: string;
    error?: string;
  }>;
}) {
  const csrf = await requestCsrfToken();
  const { source, catalog_job: catalogueJobId, error } = await searchParams;
  let playlists: PlaylistInfo[] | undefined;

  if (source && catalogueJobId) {
    let job;
    try {
      job = new JobRepository(database).get(catalogueJobId);
    } catch {
      notFound();
    }
    if (
      job.kind !== "playlist_catalogue" ||
      job.status !== "completed" ||
      job.payload?.source !== source ||
      !Array.isArray(job.payload.playlists)
    ) {
      throw new Error("playlist catalogue is not ready for this source");
    }
    playlists = job.payload.playlists as PlaylistInfo[];
  }

  const imported = source ? new ImportRepository(database).listImports().filter((item) => item.source === source) : [];
  const existingImports = Object.fromEntries(imported.map((item) => [item.sourcePlaylistId, item.id]));
  const analyses = source ? new LibraryRepository(database).playlistAnalyses(source) : {};

  return (
    <>
      {source && <h2>Choose a playlist</h2>}
      <nav className="steps compact-steps" aria-label="New import progress">
        <span className={!source ? "active" : "complete"}>1 Source</span>
        <span className={source ? "active" : "disabled"}>2 Playlist</span>
      </nav>
      {error && <p role="alert">{error}</p>}
      {!source && (
        <>
          <div className="source-grid">
            <SourceCard source="spotify" title="Spotify" description="Authorization Code + PKCE" csrf={csrf} />
            <SourceCard
              source="tidal"
              title="TIDAL"
              description="Device authentication and saved session"
              csrf={csrf}
            />
          </div>
        </>
      )}
      {source && playlists && (
        <PlaylistCatalogue
          playlists={playlists}
          existingImports={existingImports}
          csrf={csrf}
          acquisitionAction={queuePlaylistAcquisition}
          analyses={analyses}
          analysisAction={queuePlaylistAnalysis}
        />
      )}
    </>
  );
}

function NewImportSkeleton() {
  return <section className="card skeleton">Loading import sources…</section>;
}

function SourceCard({
  source,
  title,
  description,
  csrf,
}: {
  source: string;
  title: string;
  description: string;
  csrf: string;
}) {
  return (
    <form className="card source-card" action={queuePlaylistCatalogue}>
      <input type="hidden" name="csrf_token" value={csrf} />
      <input type="hidden" name="source" value={source} />
      <button className="card-button" aria-label={`Choose ${title}`}>
        <strong>{title}</strong>
        <span>{description}</span>
      </button>
    </form>
  );
}
