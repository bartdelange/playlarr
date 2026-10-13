import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import type {
  SourcePlaylist,
  SourcePlaylistTrack,
} from '@playlarr/spotify-contracts';

@Entity({ tableName: 'spotify_imports' })
export class SpotifyImportEntity {
  @PrimaryKey()
  id!: string;

  @Property({ type: 'json' })
  playlist!: SourcePlaylist;

  @Property({ type: 'json' })
  tracks!: SourcePlaylistTrack[];

  @Property()
  createdAt!: Date;
}
