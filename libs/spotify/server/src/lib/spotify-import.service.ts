import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
    const playlist = await this.api.getPlaylist(playlistId);
    const contents = await this.api.getPlaylistContents(playlistId);
    const currentPlaylist = await this.api.getPlaylist(playlistId);
    if (currentPlaylist.snapshotId !== playlist.snapshotId)
      throw new ConflictException(
        'Spotify playlist changed during import; try again',
      );
    const imported = await this.repository.createImport(
      currentPlaylist,
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
