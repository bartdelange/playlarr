import { spawn } from 'node:child_process';

import {
  ProductionSupervisor,
  type ShutdownSignal,
} from './production-supervisor.js';

const server = spawn(
  'pnpm',
  ['--filter', '@playlarr/server', 'exec', 'node', 'dist/main.js'],
  { stdio: 'inherit' },
);
const web = spawn(
  'pnpm',
  ['--filter', '@playlarr/web', 'exec', 'next', 'start'],
  { stdio: 'inherit' },
);

const supervisor = new ProductionSupervisor([
  { name: 'server', child: server },
  { name: 'web', child: web },
]);

for (const signal of ['SIGINT', 'SIGTERM'] satisfies ShutdownSignal[]) {
  process.on(signal, () => {
    supervisor.shutdown(signal);
  });
}

process.exitCode = await supervisor.completion;
