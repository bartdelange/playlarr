import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import type {
  SourcePlaylist,
  SourcePlaylistTrack,
} from '@playlarr/tidal-contracts';

@Entity({ tableName: 'tidal_imports' })
export class TidalImportEntity {
  @PrimaryKey()
  id!: string;

  @Property({ type: 'json' })
  playlist!: SourcePlaylist;

  @Property({ type: 'json' })
  tracks!: SourcePlaylistTrack[];

  @Property()
  createdAt!: Date;
}
