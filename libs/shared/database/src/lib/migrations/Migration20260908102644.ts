import { Migration } from '@mikro-orm/migrations';

export class Migration20260908102644 extends Migration {
  override name = 'Migration20260908102644';

  override up(): void | Promise<void> {
    this.addSql(
      `create table \`commands\` (\`id\` text not null primary key, \`type\` text not null, \`payload_json\` json not null, \`status\` text not null default 'queued', \`current\` integer not null default 0, \`total\` integer not null default 0, \`current_item\` text null, \`attempts\` integer not null default 0, \`error\` text null, \`created_at\` datetime not null, \`updated_at\` datetime not null, \`started_at\` datetime null, \`completed_at\` datetime null);`,
    );
    this.addSql(
      `create index \`commands_status_created_at_idx\` on \`commands\` (\`status\`, \`created_at\`);`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists \`commands\`;`);
  }
}
