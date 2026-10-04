import { Migration } from '@mikro-orm/migrations';

export class Migration20261004120000 extends Migration {
  override name = 'Migration20261004120000';

  override up(): void {
    this.addSql(
      `create table \`auth_sessions\` (\`token_hash\` text not null primary key, \`expires_at\` datetime not null, \`created_at\` datetime not null);`,
    );
    this.addSql(
      `create index \`auth_sessions_expires_at_idx\` on \`auth_sessions\` (\`expires_at\`);`,
    );
  }

  override down(): void {
    this.addSql('drop table if exists `auth_sessions`;');
  }
}
