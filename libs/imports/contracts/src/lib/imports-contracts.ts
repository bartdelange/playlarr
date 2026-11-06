import { z } from 'zod';

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
  discNumber: z.number().int().positive().nullable(),
  trackNumber: z.number().int().positive().nullable(),
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
