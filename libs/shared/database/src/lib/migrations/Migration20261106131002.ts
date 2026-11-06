import { Migration } from '@mikro-orm/migrations';

export class Migration20261106131002 extends Migration {
  override name = 'Migration20261106131002';

  override up(): void {
    this.addSql(`create table \`tidal_imports\` (
      \`id\` text not null primary key,
      \`playlist\` json not null,
      \`tracks\` json not null,
      \`created_at\` datetime not null
    );`);
  }

  override down(): void {
    this.addSql('drop table if exists `tidal_imports`;');
  }
}
