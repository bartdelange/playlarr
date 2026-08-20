import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { database } from "../../server/runtime";
import { ImportRepository } from "../../server/persistence/import-repository";
import { JobRepository } from "../../server/persistence/job-repository";
import { dashboardImportRows } from "../../server/application/dashboard-view";
export default function DashboardPage() {
  return (
    <main>
      <section className="hero">
        <div>
          <p className="eyebrow">Music library workflow</p>
          <h1>Playlists</h1>
          <p>
            Continue matching, approve Lidarr releases, and generate
            synchronized playlists.
          </p>
        </div>
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
  const jobs = new JobRepository(database).list(4);
  const rows = dashboardImportRows(database, imports, jobs);
  const counts = database
    .prepare(
      "SELECT COUNT(*) total, SUM(CASE WHEN workflow_state = 'review_required' THEN 1 ELSE 0 END) review, SUM(CASE WHEN workflow_state IN ('waiting_for_downloads', 'library_status') THEN 1 ELSE 0 END) waiting, SUM(CASE WHEN workflow_state = 'playlist_generated' THEN 1 ELSE 0 END) complete FROM imports",
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
      <div className="home-layout">
        <section>
          <div className="section-heading">
            <div>
              <p className="eyebrow">Your imports</p>
              <h2>Playlist workflows</h2>
            </div>
          </div>
          {rows.length ? (
            <div className="playlist-home-list">
              {rows.map((row) => (
                <article className="playlist-home-row" key={row.imported.id}>
                  <Link
                    className="playlist-home-main"
                    href={`/imports/${row.imported.id}`}
                  >
                    <div>
                      <span className="badge">{row.imported.source}</span>
                      <h2>{row.imported.playlistName}</h2>
                      <small>
                        Updated{" "}
                        {row.imported.updatedAt.slice(0, 16).replace("T", " ")}
                      </small>
                    </div>
                    <div className="playlist-progress">
                      <strong>
                        {row.resolved} / {row.tracks}
                      </strong>
                      <span>tracks matched</span>
                      {!!row.review && <small>{row.review} need review</small>}
                    </div>
                    <div className="playlist-next">
                      <span className="badge">
                        {row.imported.workflowState.replaceAll("_", " ")}
                      </span>
                      <strong>{row.nextAction}</strong>
                    </div>
                  </Link>
                  {row.job && (
                    <Link className="playlist-job" href={`/jobs/${row.job.id}`}>
                      <span className={`badge job-${row.job.status}`}>
                        {row.job.status}
                      </span>
                      <small>
                        {row.job.kind.replaceAll("_", " ")} · {row.job.current}{" "}
                        / {row.job.total}
                      </small>
                    </Link>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <div className="empty">
              <h2>No playlists yet</h2>
              <p>Add a Spotify or TIDAL playlist to begin.</p>
              <Link className="button" href="/imports/new">
                Add playlist
              </Link>
            </div>
          )}
        </section>
        <aside className="jobs-compact">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Background</p>
              <h2>Jobs</h2>
            </div>
            <Link href="/jobs">All jobs</Link>
          </div>
          {jobs.length ? (
            <div className="compact-job-list">
              {jobs.map((job) => (
                <Link href={`/jobs/${job.id}`} key={job.id}>
                  <div>
                    <strong>{job.kind.replaceAll("_", " ")}</strong>
                    <small>
                      {job.currentItem ?? `${job.current} / ${job.total}`}
                    </small>
                  </div>
                  <span className={`badge job-${job.status}`}>
                    {job.status}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="muted">No background activity yet.</p>
          )}
        </aside>
      </div>
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
