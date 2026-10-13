import { Migration } from '@mikro-orm/migrations';

export class Migration20261013120000_AddSpotifyAuth extends Migration {
  override name = 'Migration20261013120000_AddSpotifyAuth';

  override up(): void {
    this.addSql(`create table \`spotify_credentials\` (
      \`id\` text not null primary key,
      \`access_token\` text not null,
      \`refresh_token\` text not null,
      \`expires_at\` datetime not null,
      \`scope\` text not null,
      \`account_id\` text not null,
      \`display_name\` text null,
      \`reconnect_required\` integer not null default false
    );`);
    this.addSql(`create table \`spotify_oauth_attempts\` (
      \`state_hash\` text not null primary key,
      \`code_verifier\` text not null,
      \`return_path\` text not null,
      \`expires_at\` datetime not null
    );`);
    this.addSql(
      'create index `spotify_oauth_attempts_expires_at_idx` on `spotify_oauth_attempts` (`expires_at`);',
    );
  }

  override down(): void {
    this.addSql('drop table if exists `spotify_oauth_attempts`;');
    this.addSql('drop table if exists `spotify_credentials`;');
  }
}
