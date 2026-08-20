import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { database } from "../../../server/runtime";
import { JobRepository } from "../../../server/persistence/job-repository";
import { cancelJob } from "../../actions/workflows";
import { requestCsrfToken } from "../../../server/security/request";
import { queuePositions } from "../../../server/application/job-presentation";
export default function JobsPage() {
  return (
    <main>
      <p className="eyebrow">Task queue</p>
      <h1>Background jobs</h1>
      <p>Jobs continue while you browse other pages.</p>
      <Suspense fallback={<JobsSkeleton />}>
        <JobsList />
      </Suspense>
    </main>
  );
}

async function JobsList() {
  await connection();
  const jobs = new JobRepository(database).list();
  const csrf = await requestCsrfToken();
  const positions = queuePositions(jobs);
  return (
    <div className="job-list">
      {!jobs.length && (
        <div className="empty">
          <h2>No background jobs</h2>
          <p>
            Playlist analysis, resolution, Lidarr operations, and playlist
            generation will appear here.
          </p>
        </div>
      )}
      {jobs.map((job) => (
        <article className="job-row" key={job.id}>
          <Link href={`/jobs/${job.id}`}>
            <strong>{job.kind.replaceAll("_", " ")}</strong>
            <small>
              {job.status === "queued"
                ? `Queue position ${positions.get(job.id)}`
                : (job.currentItem ?? job.status.replaceAll("_", " "))}
            </small>
          </Link>
          <span className={`badge job-${job.status}`}>{job.status}</span>
          <span>
            {job.current} / {job.total}
          </span>
          {["queued", "running"].includes(job.status) &&
            !job.cancelRequested && (
              <form action={cancelJob}>
                <input type="hidden" name="csrf_token" value={csrf} />
                <input type="hidden" name="job_id" value={job.id} />
                <button>Cancel</button>
              </form>
            )}
        </article>
      ))}
    </div>
  );
}

function JobsSkeleton() {
  return <div className="card skeleton">Loading background jobs…</div>;
}
