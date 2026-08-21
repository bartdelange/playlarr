import { JobRepository } from "../persistence/job-repository";
import { config, database, settings } from "../runtime";
import { productionJobHandlers } from "./handlers";
import { DurableJobWorker } from "./worker";

async function main(): Promise<void> {
  const worker = new DurableJobWorker(new JobRepository(database), productionJobHandlers(database, config, settings));
  const shutdown = () => worker.stop();
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  await worker.run();
  database.close();
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
