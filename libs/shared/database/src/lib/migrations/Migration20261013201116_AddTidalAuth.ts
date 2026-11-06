import { Migration } from '@mikro-orm/migrations';

export class Migration20261013201116_AddTidalAuth extends Migration {
  override name = 'Migration20261013201116_AddTidalAuth';

  override up(): void {
    this.addSql(
      `create table \`tidal_credentials\` (\`id\` text not null primary key, \`access_token\` text not null, \`refresh_token\` text not null, \`revision\` text not null, \`expires_at\` datetime not null, \`scope\` text not null, \`account_id\` text not null, \`reconnect_required\` integer not null default false);`,
    );

    this.addSql(
      `create table \`tidal_oauth_attempts\` (\`state_hash\` text not null primary key, \`code_verifier\` text not null, \`binding_hash\` text not null, \`auth_session_hash\` text null, \`configuration_revision\` text not null, \`return_path\` text not null, \`expires_at\` datetime not null);`,
    );
    this.addSql(
      `create index \`tidal_oauth_attempts_expires_at_idx\` on \`tidal_oauth_attempts\` (\`expires_at\`);`,
    );
  }

  override down(): void {
    this.addSql('drop table if exists `tidal_oauth_attempts`;');
    this.addSql('drop table if exists `tidal_credentials`;');
  }
}
