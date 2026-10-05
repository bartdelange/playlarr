import { MikroORM } from '@mikro-orm/core';
import { Injectable } from '@nestjs/common';

import { SettingsEntity } from './settings.entity.js';

@Injectable()
export class SettingsRepository {
  constructor(private readonly orm: MikroORM) {}

  async get<T = unknown>(key: string): Promise<T | null> {
    const settings = await this.orm.em.fork().findOne(SettingsEntity, { key });

    return settings ? (settings.value as T) : null;
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.orm.em.fork().upsert(SettingsEntity, { key, value });
  }
}
