import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'spotify_credentials' })
export class SpotifyCredentialEntity {
  @PrimaryKey()
  id = 'spotify';

  @Property()
  accessToken!: string;

  @Property()
  refreshToken!: string;

  @Property()
  expiresAt!: Date;

  @Property()
  scope!: string;

  @Property()
  accountId!: string;

  @Property({ nullable: true })
  displayName!: string | null;

  @Property()
  reconnectRequired = false;
}
