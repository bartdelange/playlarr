import { Migration } from '@mikro-orm/migrations';

export class Migration20261113120000_AddCommandAssociation extends Migration {
  override name = 'Migration20261113120000_AddCommandAssociation';

  override up(): void {
    this.addSql(`alter table \`commands\` add column \`scope\` text null;`);
    this.addSql(`alter table \`commands\` add column \`entity_id\` text null;`);
    this.addSql(
      `create index \`commands_scope_entity_created_at_idx\` on \`commands\` (\`scope\`, \`entity_id\`, \`created_at\`);`,
    );
  }

  override down(): void {
    this.addSql(`drop index \`commands_scope_entity_created_at_idx\`;`);
    this.addSql(`alter table \`commands\` drop column \`entity_id\`;`);
    this.addSql(`alter table \`commands\` drop column \`scope\`;`);
  }
}
