import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

@Entity({
  tableName: '_runtime_metadata',
})
export class RuntimeMetadataEntity {
  @PrimaryKey()
  key!: string;

  @Property()
  value!: string;
}
