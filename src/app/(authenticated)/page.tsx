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
      <div className="home-layout">
        <section>
          <div className="section-heading">
            <div>
              <p className="eyebrow">Your imports</p>
              <h2>Playlist workflows</h2>
            </div>
          </div>
          {imports.length ? (
            <div className="playlist-home-list">
              {imports.map((item) => (
                <Link
                  className="playlist-home-row"
                  href={`/imports/${item.id}`}
                  key={item.id}
                >
                  <div>
                    <span className="badge">{item.source}</span>
                    <h2>{item.playlistName}</h2>
                    <small>
                      Updated {item.updatedAt.slice(0, 16).replace("T", " ")}
                    </small>
                  </div>
                  <div className="playlist-home-state">
                    <span className="badge">
                      {item.workflowState.replaceAll("_", " ")}
                    </span>
                    <strong>Continue workflow →</strong>
                  </div>
                </Link>
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
