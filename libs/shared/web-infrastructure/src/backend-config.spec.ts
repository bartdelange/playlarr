import { backendOrigin, nestApiUrl } from './backend-config.js';

describe('NestJS backend configuration', () => {
  it('builds an internal API URL from a root-relative path', () => {
    expect(nestApiUrl('/auth/status')).toBe(`${backendOrigin}/api/auth/status`);
  });

  it.each(['auth/status', '//attacker.example'])(
    'rejects unsafe path %s',
    (path) => {
      expect(() => nestApiUrl(path)).toThrow(
        'NestJS API paths must be root-relative',
      );
    },
  );
});
