import { z } from 'zod';

export const tidalSettingsSchema = z.object({
  clientId: z.string(),
  redirectUri: z.string(),
  revision: z.string(),
});

export type TidalSettings = z.infer<typeof tidalSettingsSchema>;
export const tidalSettingsKey = 'tidal';
