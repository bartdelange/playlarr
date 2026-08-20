import type { MusicBrainzResult } from "../domain/musicbrainz";
import type { PlaylistInfo, SourceTrack } from "../domain/playlist";
import { refreshLibraryStatus } from "./library-status";

export interface PlaylistAnalysisSource {
  getPlaylist(reference: string): Promise<PlaylistInfo>;
  getEntries(playlist: PlaylistInfo): Promise<
    {
      position: number;
      track: SourceTrack;
      skipReason?: string;
    }[]
  >;
}

export interface PlaylistAnalysisResolver {
  resolve(track: SourceTrack): Promise<MusicBrainzResult>;
}

export interface PlaylistAnalysisStore {
  savePlaylistAnalysis(
    source: string,
    playlistId: string,
    playlistName: string,
    status: string,
    result: Record<string, unknown>,
  ): void;
}

type LibraryClient = Parameters<typeof refreshLibraryStatus>[1];

export async function analyzePlaylist(
  sourceName: string,
  reference: string,
  source: PlaylistAnalysisSource,
  resolver: PlaylistAnalysisResolver,
  lidarr: LibraryClient,
  store: PlaylistAnalysisStore,
  progress: (current: number, total: number, item?: string) => void,
  cancelled: () => boolean,
) {
  progress(0, 0, "Fetching playlist metadata");
  const playlist = await source.getPlaylist(reference);
  if (playlist.isFollowed) {
    store.savePlaylistAnalysis(
      sourceName,
      reference,
      playlist.name,
      "skipped_followed",
      {},
    );
    progress(1, 1, "Analysis skipped");
    return;
  }
  const tracks = (await source.getEntries(playlist))
    .filter((entry) => !entry.skipReason)
    .map((entry) => entry.track);
  const results: MusicBrainzResult[] = [];
  for (const [index, track] of tracks.entries()) {
    if (cancelled()) return;
    results.push(await resolver.resolve(track));
    progress(
      index + 1,
      tracks.length,
      `${track.artists.join(", ")} — ${track.title}`,
    );
  }
  const statuses = await refreshLibraryStatus(results, lidarr);
  const additions = new Map<string, string>();
  statuses.forEach((status, index) => {
    const result = results[index];
    if (status.classification === "artist_missing" && result.primaryArtistId)
      additions.set(
        result.primaryArtistId,
        result.artistNames?.[0] ?? result.primaryArtistId,
      );
  });
  store.savePlaylistAnalysis(sourceName, reference, playlist.name, "complete", {
    tracks: tracks.length,
    resolved: results.filter((result) => result.resolvedVia).length,
    unresolved: results.filter((result) => !result.resolvedVia).length,
    artists_to_add: additions.size,
    artist_names: [...additions.values()].sort((left, right) =>
      left.localeCompare(right),
    ),
  });
}
