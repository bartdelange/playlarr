import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'spotify_oauth_attempts' })
export class SpotifyOAuthAttemptEntity {
  @PrimaryKey()
  stateHash!: string;

  @Property()
  codeVerifier!: string;

  @Property()
  returnPath!: string;

  @Property()
  expiresAt!: Date;
}
