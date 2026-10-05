import { Migration } from '@mikro-orm/migrations';

export class Migration20261005164444_AddSettings extends Migration {
  override name = 'Migration20261005164444_AddSettings';

  override up(): void | Promise<void> {
    this.addSql(
      `create table \`settings\` (\`key\` text not null primary key, \`value\` json not null);`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql('drop table if exists `settings`;');
  }
}
