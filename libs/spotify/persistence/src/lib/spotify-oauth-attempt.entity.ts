import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'spotify_oauth_attempts' })
export class SpotifyOAuthAttemptEntity {
  @PrimaryKey()
  stateHash!: string;

  @Property()
  codeVerifier!: string;

  @Property()
  bindingHash!: string;

  @Property({ nullable: true })
  authSessionHash!: string | null;

  @Property()
  configurationRevision!: string;

  @Property()
  returnPath!: string;

  @Property()
  expiresAt!: Date;
}
