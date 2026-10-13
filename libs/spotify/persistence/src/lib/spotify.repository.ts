import { randomUUID } from 'node:crypto';

import { MikroORM } from '@mikro-orm/core';
import { Injectable } from '@nestjs/common';

import { SettingsEntity } from '@playlarr/settings-persistence';

import { SpotifyCredentialEntity } from './spotify-credential.entity.js';
import { SpotifyOAuthAttemptEntity } from './spotify-oauth-attempt.entity.js';

export interface SpotifyCredential {
  accessToken: string;
  refreshToken: string;
  revision: string;
  expiresAt: Date;
  scope: string;
  accountId: string;
  displayName: string | null;
  reconnectRequired: boolean;
}

type SpotifyCredentialWrite = Omit<SpotifyCredential, 'revision'>;

@Injectable()
export class SpotifyRepository {
  constructor(private readonly orm: MikroORM) {}

  async getCredential(): Promise<SpotifyCredentialEntity | null> {
    return this.orm.em.fork().findOne(SpotifyCredentialEntity, 'spotify');
  }

  async replaceConfiguration(settings: unknown): Promise<void> {
    await this.orm.em.transactional(async (em) => {
      await em.upsert(SettingsEntity, { key: 'spotify', value: settings });
      await em.nativeDelete(SpotifyCredentialEntity, {});
      await em.nativeDelete(SpotifyOAuthAttemptEntity, {});
    });
  }

  async saveCredentialIfConfigurationCurrent(
    credential: SpotifyCredentialWrite,
    configurationRevision: string,
  ): Promise<boolean> {
    return this.orm.em.transactional(async (em) => {
      const settings = await em.findOne(SettingsEntity, { key: 'spotify' });
      if (
        this.configurationRevision(settings?.value) !== configurationRevision
      ) {
        return false;
      }
      await em.upsert(SpotifyCredentialEntity, {
        id: 'spotify',
        ...credential,
        revision: randomUUID(),
      });
      return true;
    });
  }

  async saveRefreshedCredentialIfCurrent(
    credential: SpotifyCredentialWrite,
    configurationRevision: string,
    credentialRevision: string,
  ): Promise<boolean> {
    return this.orm.em.transactional(async (em) => {
      const settings = await em.findOne(SettingsEntity, { key: 'spotify' });
      if (
        this.configurationRevision(settings?.value) !== configurationRevision
      ) {
        return false;
      }
      const changed = await em.nativeUpdate(
        SpotifyCredentialEntity,
        { id: 'spotify', revision: credentialRevision },
        { ...credential, revision: randomUUID() },
      );
      return changed > 0;
    });
  }

  async markReconnectRequiredIfCurrent(revision: string): Promise<boolean> {
    const changed = await this.orm.em
      .fork()
      .nativeUpdate(
        SpotifyCredentialEntity,
        { id: 'spotify', revision },
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
    await em.nativeDelete(SpotifyOAuthAttemptEntity, {
      expiresAt: { $lte: new Date() },
    });
    await em.insert(SpotifyOAuthAttemptEntity, attempt);
  }

  async consumeAttempt(
    stateHash: string,
    bindingHash: string,
  ): Promise<SpotifyOAuthAttemptEntity | null> {
    return this.orm.em.transactional(async (em) => {
      const attempt = await em.findOne(SpotifyOAuthAttemptEntity, {
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
    ) {
      return null;
    }
    return value.revision;
  }
}
