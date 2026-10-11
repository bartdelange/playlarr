import { safeReturnPath } from '../src/app/login/return-path';

describe('login return paths', () => {
  it('preserves an internal application destination', () => {
    expect(safeReturnPath('/settings?tab=lidarr')).toBe('/settings?tab=lidarr');
  });

  it.each([
    undefined,
    ['/', '/settings'],
    'https://attacker.example',
    '//attacker.example',
    '/login',
    '/login?next=/settings',
    '/login/help',
  ])('falls back to the app root for unsafe destination %j', (value) => {
    expect(safeReturnPath(value)).toBe('/');
  });
});
