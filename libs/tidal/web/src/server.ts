import 'server-only';

import { fetchNestApi } from '@playlarr/shared-web-infrastructure';
import { tidalConfigurationSchema } from '@playlarr/tidal-contracts';
import { cookies } from 'next/headers';

export async function getTidalConfiguration() {
  const response = await fetchNestApi(
    '/tidal/configuration',
    (await cookies()).toString(),
  );
  if (!response.ok) throw new Error('TIDAL configuration is unavailable');
  const parsed = tidalConfigurationSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('TIDAL configuration is invalid');
  return parsed.data;
}
