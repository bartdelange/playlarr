import { connection } from "next/server";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { database } from "../../../../server/runtime";
import { JobRepository } from "../../../../server/persistence/job-repository";
import { JobProgress } from "../../../../components/jobs/job-progress";
import { ImportRepository } from "../../../../server/persistence/import-repository";
import { jobCompletionUrl } from "../../../../server/application/job-presentation";
import { requestCsrfToken } from "../../../../server/security/request";
import { cancelJob } from "../../../actions/workflows";
import Link from "next/link";
export default function JobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <main>
      <p className="eyebrow">Background work</p>
      <Suspense fallback={<JobSkeleton />}>
        <JobDetails params={params} />
      </Suspense>
    </main>
  );
}

async function JobDetails({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  let job;
  try {
    job = new JobRepository(database).get((await params).id);
  } catch {
    notFound();
  }
  const imported = job.importId
    ? new ImportRepository(database).getImport(job.importId)
    : undefined;
  const csrf = await requestCsrfToken();
  return (
    <>
      {imported && (
        <nav className="steps" aria-label="Workflow progress">
          <Link href={`/imports/${imported.id}`}>{imported.playlistName}</Link>
          <span className="active">{job.kind.replaceAll("_", " ")}</span>
        </nav>
      )}
      <h1>{job.kind.replaceAll("_", " ")}</h1>
      <p>
        <Link href="/jobs">← All background jobs</Link>
      </p>
      <JobProgress
        initial={job}
        completionUrl={jobCompletionUrl(job)}
        csrfToken={csrf}
        cancelAction={cancelJob}
      />
    </>
  );
}

function JobSkeleton() {
  return <section className="card skeleton">Loading job details…</section>;
}
