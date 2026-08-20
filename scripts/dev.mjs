import { spawn } from "node:child_process";

const forwarded = process.argv.slice(2);
const next = spawn("next", ["dev", "--port", "8787", ...forwarded], {
  stdio: "inherit",
});
const worker = spawn("tsx", ["src/server/jobs/main.ts"], {
  stdio: "inherit",
});

let stopping = false;
function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  next.kill(signal);
  worker.kill(signal);
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

for (const child of [next, worker]) {
  child.on("exit", (code, signal) => {
    stop(signal ?? "SIGTERM");
    if (code && code !== 0) process.exitCode = code;
  });
}

await Promise.all([
  new Promise((resolve) => next.on("close", resolve)),
  new Promise((resolve) => worker.on("close", resolve)),
]);
