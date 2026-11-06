import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ImportSummary, TidalImport } from '@playlarr/tidal-contracts';
import { TidalRepository } from '@playlarr/tidal-persistence';

import { TidalApiClient } from './tidal-api.client.js';

@Injectable()
export class TidalImportService {
  constructor(
    private readonly api: TidalApiClient,
    private readonly repository: TidalRepository,
  ) {}

  async create(playlistId: string): Promise<TidalImport> {
    const playlist = await this.getPlaylist(playlistId);
    const contents = await this.api.getPlaylistContents(playlistId);
    const currentPlaylist = await this.getPlaylist(playlistId);

    // TIDAL documents lastModifiedAt as a date-time, not as an immutable
    // revision token. These checks detect timestamp or size changes around the
    // paginated read. The endpoint offers no atomic multi-page snapshot, so a
    // same-size mutation without a timestamp change cannot be excluded.
    if (
      currentPlaylist.snapshotId !== playlist.snapshotId ||
      currentPlaylist.itemCount !== playlist.itemCount ||
      contents.tracks.length !== playlist.itemCount
    )
      throw new ConflictException(
        'TIDAL playlist changed during import; try again',
      );
    const imported = await this.repository.createImport(
      currentPlaylist,
      contents.tracks,
    );
    return this.toContract(imported);
  }

  async get(id: string): Promise<TidalImport> {
    const imported = await this.repository.getImport(id);
    if (!imported) throw new NotFoundException('Import not found');
    return this.toContract(imported);
  }

  async list(): Promise<ImportSummary[]> {
    return (await this.repository.listImports()).map((imported) => ({
      id: imported.id,
      source: 'tidal',
      name: imported.playlist.name,
      trackCount: imported.tracks.length,
      unavailableTrackCount: imported.tracks.filter(
        (track) => track.status !== 'available',
      ).length,
      createdAt: imported.createdAt.toISOString(),
    }));
  }

  private async getPlaylist(playlistId: string) {
    const playlist = (await this.api.getPlaylists()).find(
      (candidate) => candidate.id === playlistId,
    );
    if (!playlist) throw new NotFoundException('TIDAL playlist not found');
    return playlist;
  }

  private toContract(imported: {
    id: string;
    playlist: TidalImport['playlist'];
    tracks: TidalImport['tracks'];
    createdAt: Date;
  }): TidalImport {
    return {
      id: imported.id,
      playlist: imported.playlist,
      tracks: imported.tracks,
      createdAt: imported.createdAt.toISOString(),
    };
  }
}
