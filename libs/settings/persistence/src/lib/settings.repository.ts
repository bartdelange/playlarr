import { MikroORM } from '@mikro-orm/core';
import { Injectable } from '@nestjs/common';
import type { ZodType } from 'zod';

import { SettingsEntity } from './settings.entity.js';

@Injectable()
export class SettingsRepository {
  constructor(private readonly orm: MikroORM) {}

  async get<T>(key: string, schema: ZodType<T>): Promise<T | null> {
    const settings = await this.orm.em.fork().findOne(SettingsEntity, { key });

    return settings ? schema.parse(settings.value) : null;
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.orm.em.fork().upsert(SettingsEntity, { key, value });
  }
}
