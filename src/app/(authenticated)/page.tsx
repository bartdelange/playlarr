import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { database } from "../../server/runtime";
import { ImportRepository } from "../../server/persistence/import-repository";
import { JobRepository } from "../../server/persistence/job-repository";
export default function DashboardPage() {
  return (
    <main>
      <section className="hero">
        <p className="eyebrow">Music library workflow</p>
        <h1>Playlists</h1>
        <p>
          Continue matching, approve Lidarr releases, and generate synchronized
          playlists.
        </p>
        <Link className="button" href="/imports/new">
          Add playlist
        </Link>
      </section>
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardData />
      </Suspense>
    </main>
  );
}
async function DashboardData() {
  await connection();
  const imports = new ImportRepository(database).listImports();
  const jobs = new JobRepository(database).list(8);
  const counts = database
    .prepare(
      "SELECT COUNT(*) total, SUM(CASE WHEN workflow_state = 'review_required' THEN 1 ELSE 0 END) review, SUM(CASE WHEN workflow_state = 'waiting_for_downloads' THEN 1 ELSE 0 END) waiting, SUM(CASE WHEN workflow_state = 'playlist_generated' THEN 1 ELSE 0 END) complete FROM imports",
    )
    .get() as Record<string, number>;
  return (
    <>
      <section className="stats">
        <span>
          <strong>{counts.total}</strong> playlists
        </span>
        <span>
          <strong>{counts.review ?? 0}</strong> need review
        </span>
        <span>
          <strong>{counts.waiting ?? 0}</strong> waiting
        </span>
        <span>
          <strong>{counts.complete ?? 0}</strong> ready
        </span>
      </section>
      <section>
        <h2>Your imports</h2>
        {imports.length ? (
          <div className="card-list">
            {imports.map((item) => (
              <Link className="card" href={`/imports/${item.id}`} key={item.id}>
                <span className="badge">{item.source}</span>
                <strong>{item.playlistName}</strong>
                <small>{item.workflowState.replaceAll("_", " ")}</small>
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty">
            <h2>No playlists yet</h2>
            <p>Add a Spotify or TIDAL playlist to begin.</p>
          </div>
        )}
      </section>
      <section>
        <h2>Recent jobs</h2>
        {jobs.map((job) => (
          <Link href={`/jobs/${job.id}`} className="job-row" key={job.id}>
            <strong>{job.kind.replaceAll("_", " ")}</strong>
            <span className={`badge job-${job.status}`}>{job.status}</span>
            <span>
              {job.current} / {job.total}
            </span>
          </Link>
        ))}
      </section>
    </>
  );
}
function DashboardSkeleton() {
  return (
    <>
      <section className="stats skeleton">
        <span>Loading playlist counts…</span>
      </section>
      <section className="card skeleton">Loading imports…</section>
    </>
  );
}
