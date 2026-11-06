import { randomUUID } from 'node:crypto';

import { MikroORM } from '@mikro-orm/core';
import { Injectable } from '@nestjs/common';
import { SettingsEntity } from '@playlarr/settings-persistence';

import { TidalCredentialEntity } from './tidal-credential.entity.js';
import { TidalOAuthAttemptEntity } from './tidal-oauth-attempt.entity.js';

export interface TidalCredential {
  accessToken: string;
  refreshToken: string;
  revision: string;
  expiresAt: Date;
  scope: string;
  accountId: string;
  reconnectRequired: boolean;
}

type TidalCredentialWrite = Omit<TidalCredential, 'revision'>;

@Injectable()
export class TidalRepository {
  constructor(private readonly orm: MikroORM) {}

  getCredential(): Promise<TidalCredentialEntity | null> {
    return this.orm.em.fork().findOne(TidalCredentialEntity, 'tidal');
  }

  async replaceConfiguration(settings: unknown): Promise<void> {
    await this.orm.em.transactional(async (em) => {
      await em.upsert(SettingsEntity, { key: 'tidal', value: settings });
      await em.nativeDelete(TidalCredentialEntity, {});
      await em.nativeDelete(TidalOAuthAttemptEntity, {});
    });
  }

  async saveCredentialIfConfigurationCurrent(
    credential: TidalCredentialWrite,
    configurationRevision: string,
  ): Promise<boolean> {
    return this.orm.em.transactional(async (em) => {
      const settings = await em.findOne(SettingsEntity, { key: 'tidal' });
      if (this.configurationRevision(settings?.value) !== configurationRevision)
        return false;
      await em.upsert(TidalCredentialEntity, {
        id: 'tidal',
        ...credential,
        revision: randomUUID(),
      });
      return true;
    });
  }

  async saveRefreshedCredentialIfCurrent(
    credential: TidalCredentialWrite,
    configurationRevision: string,
    credentialRevision: string,
  ): Promise<boolean> {
    return this.orm.em.transactional(async (em) => {
      const settings = await em.findOne(SettingsEntity, { key: 'tidal' });
      if (this.configurationRevision(settings?.value) !== configurationRevision)
        return false;
      const changed = await em.nativeUpdate(
        TidalCredentialEntity,
        { id: 'tidal', revision: credentialRevision },
        { ...credential, revision: randomUUID() },
      );
      return changed > 0;
    });
  }

  async markReconnectRequiredIfCurrent(revision: string): Promise<boolean> {
    const changed = await this.orm.em
      .fork()
      .nativeUpdate(
        TidalCredentialEntity,
        { id: 'tidal', revision },
        { reconnectRequired: true },
      );
    return changed > 0;
  }

  async createAttempt(attempt: {
    stateHash: string;
    codeVerifier: string;
    bindingHash: string;
    authSessionHash: string | null;
    configurationRevision: string;
    returnPath: string;
    expiresAt: Date;
  }): Promise<void> {
    const em = this.orm.em.fork();
    await em.nativeDelete(TidalOAuthAttemptEntity, {
      expiresAt: { $lte: new Date() },
    });
    await em.insert(TidalOAuthAttemptEntity, attempt);
  }

  consumeAttempt(
    stateHash: string,
    bindingHash: string,
  ): Promise<TidalOAuthAttemptEntity | null> {
    return this.orm.em.transactional(async (em) => {
      const attempt = await em.findOne(TidalOAuthAttemptEntity, {
        stateHash,
        bindingHash,
      });
      if (!attempt) return null;
      em.remove(attempt);
      await em.flush();
      return attempt;
    });
  }

  private configurationRevision(value: unknown): string | null {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('revision' in value) ||
      typeof value.revision !== 'string'
    )
      return null;
    return value.revision;
  }
}
