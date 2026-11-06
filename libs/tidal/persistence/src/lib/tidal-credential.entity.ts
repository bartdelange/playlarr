import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'tidal_credentials' })
export class TidalCredentialEntity {
  @PrimaryKey()
  id!: string;

  @Property()
  accessToken!: string;

  @Property()
  refreshToken!: string;

  @Property()
  revision!: string;

  @Property()
  expiresAt!: Date;

  @Property()
  scope!: string;

  @Property()
  accountId!: string;

  @Property()
  reconnectRequired = false;
}
