import {
  Entity,
  Index,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'auth_sessions' })
export class AuthSessionEntity {
  @PrimaryKey()
  tokenHash!: string;

  @Property()
  @Index({ name: 'auth_sessions_expires_at_idx' })
  expiresAt!: Date;

  @Property({ onCreate: () => new Date() })
  createdAt: Date = new Date();
}
