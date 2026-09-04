import { expect, test } from '@playwright/test';

test('proxies the backend API through the web origin', async ({ request }) => {
  const response = await request.get('/api/health');

  expect(response.status()).toBe(200);

  expect(await response.json()).toEqual({
    status: 'ok',
  });
});
