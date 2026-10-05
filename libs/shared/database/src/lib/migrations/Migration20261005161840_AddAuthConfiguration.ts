import { Migration } from '@mikro-orm/migrations';

export class Migration20261005161840_AddAuthConfiguration extends Migration {
  override name = 'Migration20261005161840_AddAuthConfiguration';

  override up(): void | Promise<void> {
    this.addSql(
      `create table \`auth_configuration\` (\`id\` integer not null primary key, \`enabled\` integer not null, \`username\` text not null, \`password_hash\` text not null, \`session_lifetime_seconds\` integer not null);`,
    );
  }
}
