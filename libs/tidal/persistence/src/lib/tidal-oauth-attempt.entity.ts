import {
  Entity,
  Index,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'tidal_oauth_attempts' })
export class TidalOAuthAttemptEntity {
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

  @Index({ name: 'tidal_oauth_attempts_expires_at_idx' })
  @Property()
  expiresAt!: Date;
}
