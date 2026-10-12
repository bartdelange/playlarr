import 'server-only';

import { nestApiUrl } from './backend-config.js';

export function fetchNestApi(
  path: string,
  cookie: string | null = null,
): Promise<Response> {
  return fetch(nestApiUrl(path), {
    cache: 'no-store',
    headers: cookie ? { cookie } : undefined,
  });
}
