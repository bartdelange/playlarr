import { PassThrough, Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { writePasswordHash } from './hash-password.js';
import { verifyPassword } from './lib/password.js';

describe('password hash command', () => {
  it('writes a usable hash for the password supplied on standard input', async () => {
    const output = new PassThrough();
    let written = '';

    output.setEncoding('utf8');
    output.on('data', (chunk: string) => {
      written += chunk;
    });

    await writePasswordHash(Readable.from(['operator secret']), output);

    const hash = written.trimEnd();

    expect(hash).not.toContain('operator secret');
    await expect(verifyPassword('operator secret', hash)).resolves.toBe(true);
  });
});
