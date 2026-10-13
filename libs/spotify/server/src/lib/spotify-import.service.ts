import { Injectable, NotFoundException } from '@nestjs/common';
import type { SpotifyImport } from '@playlarr/spotify-contracts';
import { SpotifyRepository } from '@playlarr/spotify-persistence';

import { SpotifyApiClient } from './spotify-api.client.js';

@Injectable()
export class SpotifyImportService {
  constructor(
    private readonly api: SpotifyApiClient,
    private readonly repository: SpotifyRepository,
  ) {}

  async create(playlistId: string): Promise<SpotifyImport> {
    const [playlists, contents] = await Promise.all([
      this.api.getPlaylists(),
      this.api.getPlaylistContents(playlistId),
    ]);
    const playlist = playlists.find((candidate) => candidate.id === playlistId);
    if (!playlist) throw new NotFoundException('Spotify playlist not found');
    const imported = await this.repository.createImport(
      playlist,
      contents.tracks,
    );
    return this.toContract(imported);
  }

  async get(id: string): Promise<SpotifyImport> {
    const imported = await this.repository.getImport(id);
    if (!imported) throw new NotFoundException('Import not found');
    return this.toContract(imported);
  }

  private toContract(imported: {
    id: string;
    playlist: SpotifyImport['playlist'];
    tracks: SpotifyImport['tracks'];
    createdAt: Date;
  }): SpotifyImport {
    return {
      id: imported.id,
      playlist: imported.playlist,
      tracks: imported.tracks,
      createdAt: imported.createdAt.toISOString(),
    };
  }
}
