import { MikroORM } from '@mikro-orm/core';
import { Injectable } from '@nestjs/common';

import { SettingsEntity } from '@playlarr/settings-persistence';

import { AuthSessionEntity } from './auth-session.entity.js';

interface ReplacementSession {
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
}

@Injectable()
export class AuthStateRepository {
  constructor(private readonly orm: MikroORM) {}

  async replaceConfiguration(
    settings: unknown,
    replacementSession: ReplacementSession | null,
  ): Promise<void> {
    await this.orm.em.transactional(async (em) => {
      await em.upsert(SettingsEntity, { key: 'auth', value: settings });
      await em.nativeDelete(AuthSessionEntity, {});

      if (replacementSession) {
        em.create(AuthSessionEntity, replacementSession);
        await em.flush();
      }
    });
  }
}
