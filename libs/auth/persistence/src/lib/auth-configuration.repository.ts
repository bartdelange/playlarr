import { MikroORM } from '@mikro-orm/core';
import { Injectable } from '@nestjs/common';

import { AuthConfigurationEntity } from './auth-configuration.entity.js';

export interface AuthConfiguration {
  enabled: boolean;
  username: string;
  passwordHash: string;
  sessionLifetimeSeconds: number;
}

@Injectable()
export class AuthConfigurationRepository {
  constructor(private readonly orm: MikroORM) {}

  async find(): Promise<AuthConfiguration | null> {
    const configuration = await this.orm.em
      .fork()
      .findOne(AuthConfigurationEntity, 1);

    if (!configuration) {
      return null;
    }

    return {
      enabled: configuration.enabled,
      username: configuration.username,
      passwordHash: configuration.passwordHash,
      sessionLifetimeSeconds: configuration.sessionLifetimeSeconds,
    };
  }

  async save(configuration: AuthConfiguration): Promise<void> {
    const em = this.orm.em.fork();

    await em.upsert(AuthConfigurationEntity, {
      id: 1,
      ...configuration,
    });
  }
}
