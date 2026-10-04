import { stdin, stdout } from 'node:process';
import type { Readable, Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';

import { hashPassword } from './lib/password.js';

export async function writePasswordHash(
  input: Readable,
  output: Writable,
): Promise<void> {
  const chunks: Buffer[] = [];

  for await (const chunk of input) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const password = Buffer.concat(chunks).toString('utf8');

  if (!password) {
    throw new Error('Provide the password on standard input');
  }

  output.write(`${await hashPassword(password)}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void writePasswordHash(stdin, stdout).catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
