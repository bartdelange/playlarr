import { Migration } from '@mikro-orm/migrations';

export class Migration20260825230000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table if not exists "_runtime_metadata" (
        "key" text not null,
        "value" text not null,
        constraint "_runtime_metadata_pkey" primary key ("key")
      );
    `);
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "_runtime_metadata";');
  }
}
