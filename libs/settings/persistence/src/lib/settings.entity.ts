import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'settings' })
export class SettingsEntity {
  @PrimaryKey()
  key!: string;

  @Property({ type: 'json' })
  value!: unknown;
}
