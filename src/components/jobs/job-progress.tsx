"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { StoredJob } from "../../server/persistence/job-repository";
type JobResponse = StoredJob & { completionUrl?: string };
export function JobProgress({
  initial,
  completionUrl,
  csrfToken,
  cancelAction,
}: {
  initial: StoredJob;
  completionUrl?: string;
  csrfToken: string;
  cancelAction: (form: FormData) => Promise<void>;
}) {
  const [job, setJob] = useState(initial);
  const [destination, setDestination] = useState(completionUrl);
  const router = useRouter();
  useEffect(() => {
    if (!["queued", "running"].includes(job.status)) return;
    const timer = setInterval(async () => {
      const response = await fetch(`/api/jobs/${job.id}`, {
        cache: "no-store",
      });
      if (response.ok) {
        const result = (await response.json()) as JobResponse;
        setJob(result);
        setDestination(result.completionUrl);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [job.id, job.status]);
  useEffect(() => {
    if (job.status !== "completed" || !destination) return;
    const timer = setTimeout(() => router.push(destination), 800);
    return () => clearTimeout(timer);
  }, [destination, job.status, router]);
  return (
    <section className="card">
      <span className={`badge job-${job.status}`}>{job.status}</span>
      <h2>{job.kind.replaceAll("_", " ")}</h2>
      <progress max={job.total || 1} value={job.current} />
      <p>
        {job.current} / {job.total}
      </p>
      <p>{job.currentItem}</p>
      {job.error && <p role="alert">{job.error}</p>}
      {["queued", "running"].includes(job.status) && !job.cancelRequested && (
        <form action={cancelAction}>
          <input type="hidden" name="csrf_token" value={csrfToken} />
          <input type="hidden" name="job_id" value={job.id} />
          <button className="secondary">Cancel</button>
        </form>
      )}
      {job.status === "completed" && destination && (
        <Link className="button" href={destination}>
          {job.kind === "playlist_catalogue"
            ? "Choose a playlist"
            : job.kind === "playlist_update_preview"
              ? "Review source update"
              : "Return to playlist"}
        </Link>
      )}
    </section>
  );
}
