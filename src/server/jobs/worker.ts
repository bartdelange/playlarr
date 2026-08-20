import { setTimeout as delay } from "node:timers/promises";
import type { JobRepository, StoredJob } from "../persistence/job-repository";

export type JobHandler = (
  job: StoredJob,
  progress: (current: number, total: number, item?: string) => void,
  cancelled: () => boolean,
) => Promise<void>;
export class DurableJobWorker {
  private stopping = false;
  constructor(
    private readonly jobs: JobRepository,
    private readonly handlers: Record<string, JobHandler>,
    private readonly pollMilliseconds = 500,
  ) {}
  stop() {
    this.stopping = true;
  }
  async run(): Promise<void> {
    while (!this.stopping) {
      if (!(await this.runOnce())) await delay(this.pollMilliseconds);
    }
  }
  async runOnce(): Promise<boolean> {
    const job = this.jobs.claimNext();
    if (!job) return false;
    const handler = this.handlers[job.kind];
    if (!handler) {
      this.jobs.update(job.id, {
        status: "failed",
        error: `unsupported job kind: ${job.kind}`,
      });
      return true;
    }
    const cancelled = () => this.jobs.get(job.id).cancelRequested;
    try {
      await handler(
        job,
        (current, total, item) =>
          this.jobs.update(job.id, { current, total, currentItem: item }),
        cancelled,
      );
      this.jobs.update(job.id, {
        status: cancelled() ? "cancelled" : "completed",
      });
    } catch (error) {
      this.jobs.update(
        job.id,
        cancelled()
          ? { status: "cancelled" }
          : {
              status: "failed",
              error: error instanceof Error ? error.message : String(error),
            },
      );
    }
    return true;
  }
}
