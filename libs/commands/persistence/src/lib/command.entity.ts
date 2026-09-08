import {
  Entity,
  Index,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';
import type { CommandStatus } from '@playlarr/commands-domain';

@Entity({ tableName: 'commands' })
@Index({
  name: 'commands_status_created_at_idx',
  properties: ['status', 'createdAt'],
})
export class CommandEntity {
  @PrimaryKey()
  id!: string;

  @Property()
  type!: string;

  @Property({ type: 'json' })
  payloadJson!: unknown;

  @Property()
  status: CommandStatus = 'queued';

  @Property()
  current = 0;

  @Property()
  total = 0;

  @Property({ nullable: true })
  currentItem?: string;

  @Property()
  attempts = 0;

  @Property({ nullable: true })
  error?: string;

  @Property({ onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({
    onCreate: () => new Date(),
    onUpdate: () => new Date(),
  })
  updatedAt: Date = new Date();

  @Property({ nullable: true })
  startedAt?: Date;

  @Property({ nullable: true })
  completedAt?: Date;
}
