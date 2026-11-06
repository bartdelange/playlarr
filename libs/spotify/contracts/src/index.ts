import { z } from 'zod';
import {
  sourcePlaylistSchema,
  sourcePlaylistTrackSchema,
} from '@playlarr/imports-contracts';

export * from '@playlarr/imports-contracts';

export const spotifyConnectionStatusSchema = z.enum([
  'not_configured',
  'not_connected',
  'connected',
  'reconnect_required',
]);

export const spotifyConfigurationSchema = z.object({
  clientId: z.string(),
  redirectUri: z.string(),
  clientSecretConfigured: z.boolean(),
  status: spotifyConnectionStatusSchema,
  account: z
    .object({ id: z.string(), displayName: z.string().nullable() })
    .nullable(),
});

export type SpotifyConfiguration = z.infer<typeof spotifyConfigurationSchema>;

export const spotifyConfigurationInputSchema = z.object({
  clientId: z.string().trim().min(1).max(256),
  clientSecret: z.string().min(1).max(1024).optional(),
  redirectUri: z
    .url()
    .max(2048)
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === 'https:' ||
        (url.protocol === 'http:' &&
          (url.hostname === '127.0.0.1' || url.hostname === '[::1]'))
      );
    }, 'redirectUri must use HTTPS or an explicit loopback IP address'),
});

export type SpotifyConfigurationInput = z.infer<
  typeof spotifyConfigurationInputSchema
>;

export const spotifyImportSchema = z.object({
  id: z.uuid(),
  playlist: sourcePlaylistSchema,
  tracks: z.array(sourcePlaylistTrackSchema),
  createdAt: z.iso.datetime(),
});

export type SpotifyImport = z.infer<typeof spotifyImportSchema>;
