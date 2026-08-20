import type { LocalAdditionsRepository } from "../persistence/local-additions-repository";

export interface AuthoritativeLocalSong {
  id: string;
  title: string;
  artist: string;
  album: string;
  path: string;
}

export interface LocalSongSource {
  song(id: string): Promise<AuthoritativeLocalSong>;
}

export async function addAuthoritativeLocalTrack(
  repository: LocalAdditionsRepository,
  source: LocalSongSource,
  importId: string,
  songId: string,
) {
  const song = await source.song(songId);
  return repository.add(
    importId,
    {
      provider: "navidrome",
      providerTrackId: song.id,
      title: song.title,
      artists: song.artist ? [song.artist] : [],
      album: song.album,
    },
    song.path,
  );
}
