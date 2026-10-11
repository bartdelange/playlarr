import { expect, test } from '@playwright/test';

test('proxies the backend API through the web origin', async ({ request }) => {
  const response = await request.get('/api/health');

  expect(response.status()).toBe(200);

  expect(await response.json()).toEqual({
    status: 'ok',
  });
});

test('preserves same-origin CSRF protection through the web proxy', async ({
  baseURL,
  request,
}) => {
  const publicOrigin = requireBaseUrl(baseURL);

  const sameOriginMutation = await request.post('/api/sample-command', {
    data: { steps: 1 },
    headers: { Origin: publicOrigin },
  });

  expect(sameOriginMutation.status()).toBe(201);

  const crossOriginMutation = await request.post('/api/sample-command', {
    data: { steps: 1 },
    headers: {
      Origin: 'https://attacker.example',
      'X-Forwarded-Host': 'attacker.example',
    },
  });

  expect(crossOriginMutation.status()).toBe(403);
});

function requireBaseUrl(value: string | undefined): string {
  if (!value) {
    throw new Error('Playwright baseURL is required');
  }

  return value;
}
