import { z } from 'zod';

export const spotifySettingsSchema = z.object({
  clientId: z.string(),
  clientSecret: z.string(),
  redirectUri: z.string(),
  revision: z.string(),
});

export type SpotifySettings = z.infer<typeof spotifySettingsSchema>;
export const spotifySettingsKey = 'spotify';
