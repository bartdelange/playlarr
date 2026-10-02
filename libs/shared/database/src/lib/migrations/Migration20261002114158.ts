import { Migration } from '@mikro-orm/migrations';

export class Migration20261002114158 extends Migration {
  override name = 'Migration20261002114158';

  override up(): void | Promise<void> {
    this.addSql(
      `alter table \`commands\` add column \`revision\` integer not null default 0;`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table \`commands\` drop column \`revision\`;`);
  }
}
