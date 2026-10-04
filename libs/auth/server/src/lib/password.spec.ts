import { describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword } from './password.js';

describe('password hashing', () => {
  it('verifies only the password used to create a scrypt hash', async () => {
    const hash = await hashPassword('correct horse battery staple');

    await expect(
      verifyPassword('correct horse battery staple', hash),
    ).resolves.toBe(true);
    await expect(verifyPassword('wrong password', hash)).resolves.toBe(false);
    expect(hash).not.toContain('correct horse battery staple');
  });

  it('rejects malformed and unsupported hashes', async () => {
    await expect(verifyPassword('password', 'not-a-hash')).resolves.toBe(false);
    await expect(
      verifyPassword('password', 'scrypt$999999$8$1$c2FsdA==$aW52YWxpZA=='),
    ).resolves.toBe(false);
  });
});
