import { Migration } from '@mikro-orm/migrations';

export class Migration20261013180000_AddSpotifyImports extends Migration {
  override name = 'Migration20261013180000_AddSpotifyImports';

  override up(): void {
    this.addSql(`create table \`spotify_imports\` (
      \`id\` text not null primary key,
      \`playlist\` json not null,
      \`tracks\` json not null,
      \`created_at\` datetime not null
    );`);
  }

  override down(): void {
    this.addSql('drop table if exists `spotify_imports`;');
  }
}
