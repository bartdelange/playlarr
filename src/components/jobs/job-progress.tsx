"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { StoredJob } from "../../server/persistence/job-repository";
export function JobProgress({ initial }: { initial: StoredJob }) {
  const [job, setJob] = useState(initial);
  useEffect(() => {
    if (!["queued", "running"].includes(job.status)) return;
    const timer = setInterval(async () => {
      const response = await fetch(`/api/jobs/${job.id}`, {
        cache: "no-store",
      });
      if (response.ok) setJob(await response.json());
    }, 1000);
    return () => clearInterval(timer);
  }, [job.id, job.status]);
  const destination =
    job.status !== "completed"
      ? undefined
      : job.kind === "playlist_catalogue" && job.payload?.source
        ? `/imports/new?source=${encodeURIComponent(String(job.payload.source))}&catalog_job=${job.id}`
        : job.importId
          ? job.kind === "playlist_update_preview"
            ? `/imports/${job.importId}/update?preview_job=${job.id}`
            : `/imports/${job.importId}`
          : undefined;
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
      {destination && (
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
