import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ProductionSupervisor,
  type ShutdownSignal,
} from './production-supervisor.js';

const serverPath = fileURLToPath(new URL('./main.js', import.meta.url));
const webPath =
  process.env['PLAYLARR_WEB_SERVER_PATH'] ??
  resolve('apps/web/.next/standalone/apps/web/server.js');

const server = spawn(process.execPath, [serverPath], { stdio: 'inherit' });
const web = spawn(process.execPath, [webPath], { stdio: 'inherit' });

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
