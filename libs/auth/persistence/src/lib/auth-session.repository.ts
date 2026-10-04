import { MikroORM } from '@mikro-orm/core';
import { Injectable } from '@nestjs/common';

import { AuthSessionEntity } from './auth-session.entity.js';

@Injectable()
export class AuthSessionRepository {
  constructor(private readonly orm: MikroORM) {}

  async create(tokenHash: string, expiresAt: Date): Promise<void> {
    const em = this.orm.em.fork();

    em.create(AuthSessionEntity, {
      tokenHash,
      expiresAt,
      createdAt: new Date(),
    });
    await em.flush();
  }

  async isValid(tokenHash: string, now = new Date()): Promise<boolean> {
    const session = await this.orm.em.fork().findOne(AuthSessionEntity, {
      tokenHash,
      expiresAt: { $gt: now },
    });

    return session !== null;
  }

  async delete(tokenHash: string): Promise<void> {
    await this.orm.em.fork().nativeDelete(AuthSessionEntity, { tokenHash });
  }
}
