import { z } from 'zod';

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

export const sourcePlaylistSchema = z.object({
  id: z.string(),
  name: z.string(),
  owner: z.object({ id: z.string(), displayName: z.string().nullable() }),
  itemCount: z.number().int().nonnegative(),
  snapshotId: z.string(),
});

export type SourcePlaylist = z.infer<typeof sourcePlaylistSchema>;

const sourceTrackDetailsSchema = z.object({
  sourceId: z.string(),
  name: z.string(),
  artists: z.array(z.string()),
  album: z.string(),
  durationMs: z.number().int().nonnegative(),
  discNumber: z.number().int().positive(),
  trackNumber: z.number().int().positive(),
});

export const sourcePlaylistTrackSchema = z.discriminatedUnion('status', [
  sourceTrackDetailsSchema.extend({
    position: z.number().int().nonnegative(),
    status: z.literal('available'),
  }),
  z.object({
    position: z.number().int().nonnegative(),
    status: z.enum(['unavailable', 'local', 'unsupported']),
  }),
]);

export type SourcePlaylistTrack = z.infer<typeof sourcePlaylistTrackSchema>;

export const sourcePlaylistContentsSchema = z.object({
  playlistId: z.string(),
  tracks: z.array(sourcePlaylistTrackSchema),
});

export type SourcePlaylistContents = z.infer<
  typeof sourcePlaylistContentsSchema
>;
