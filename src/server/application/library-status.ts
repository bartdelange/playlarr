import path from "node:path";
import type { MusicBrainzResult } from "../domain/musicbrainz";
import type { LibraryStatus } from "../persistence/library-repository";

interface LidarrLibraryClient {
  artists(): Promise<Record<string, unknown>[]>;
  albumsByForeignId(id: string): Promise<Record<string, unknown>[]>;
  tracksByArtistId(id: number): Promise<Record<string, unknown>[]>;
  tracksByAlbumId(id: number): Promise<Record<string, unknown>[]>;
  trackFilesByArtistId(id: number): Promise<Record<string, unknown>[]>;
}
const normalizedTitle = (value: unknown) => String(value ?? "").toLocaleLowerCase().replace(/\([^)]*(edit|version|mix)\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const trackPath = (track: Record<string, unknown>, files: Map<number, Record<string, unknown>>, artistPath?: string): string | undefined => { const embedded = track.trackFile as Record<string, unknown> | undefined; const file = embedded ?? files.get(Number(track.trackFileId)) ?? {}; if (file.path) return String(file.path); return file.relativePath && artistPath ? path.join(artistPath, String(file.relativePath)) : undefined; };
const matches = (track: Record<string, unknown>, result: MusicBrainzResult) => result.recordingIds?.includes(String(track.foreignRecordingId ?? track.foreignTrackId ?? "")) || Boolean(result.recordingTitle && normalizedTitle(track.title) === normalizedTitle(result.recordingTitle));

export async function refreshLibraryStatus(results: MusicBrainzResult[], client: LidarrLibraryClient, progress?: (current: number, total: number, item?: string) => void): Promise<LibraryStatus[]> {
  const artists = new Map((await client.artists()).map((artist) => [String(artist.foreignArtistId), artist])); const total = results.length || 1; const statuses: LibraryStatus[] = [];
  for (const [position, result] of results.entries()) {
    let classification = !result.primaryArtistId ? "musicbrainz_unresolved" : !result.releaseGroupIds?.length ? "release_group_unresolved" : "artist_missing"; let filePath: string | undefined;
    const artist = result.primaryArtistId ? artists.get(result.primaryArtistId) : undefined;
    if (artist) {
      const artistId = Number(artist.id); const files = new Map((await client.trackFilesByArtistId(artistId)).filter((file) => file.id !== undefined).map((file) => [Number(file.id), file])); const artistTracks = await client.tracksByArtistId(artistId); const direct = artistTracks.find((track) => track.hasFile && matches(track, result));
      if (direct) { filePath = trackPath(direct, files, artist.path ? String(artist.path) : undefined); classification = filePath ? "represented_locally" : "recording_match"; }
      if (!filePath) for (const group of result.releaseGroupIds ?? []) { const album = (await client.albumsByForeignId(group)).find((item) => item.foreignAlbumId === group); if (!album) { classification = "release_missing"; continue; } const owner = album.artist as Record<string, unknown> | undefined; const ownerId = Number(album.artistId ?? owner?.id); const ownerFiles = ownerId === artistId ? files : new Map((await client.trackFilesByArtistId(ownerId)).filter((file) => file.id !== undefined).map((file) => [Number(file.id), file])); const candidate = (await client.tracksByAlbumId(Number(album.id))).find((track) => track.hasFile && matches(track, result)); if (candidate) { filePath = trackPath(candidate, ownerFiles, owner?.path ? String(owner.path) : undefined); classification = filePath ? "represented_locally" : "release_downloaded"; break; } classification = album.monitored ? "release_monitored_missing" : "release_unmonitored_missing"; }
    }
    statuses.push({ position, classification, path: filePath }); progress?.(position + 1, total, result.recordingTitle ?? result.artistNames?.[0]);
  }
  return statuses;
}
