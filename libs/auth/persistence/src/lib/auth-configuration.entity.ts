import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'auth_configuration' })
export class AuthConfigurationEntity {
  @PrimaryKey({ autoincrement: false })
  id!: number;

  @Property()
  enabled!: boolean;

  @Property()
  username!: string;

  @Property()
  passwordHash!: string;

  @Property()
  sessionLifetimeSeconds!: number;
}
