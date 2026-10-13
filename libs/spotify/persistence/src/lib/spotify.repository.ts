import { MikroORM } from '@mikro-orm/core';
import { Injectable } from '@nestjs/common';

import { SpotifyCredentialEntity } from './spotify-credential.entity.js';
import { SpotifyOAuthAttemptEntity } from './spotify-oauth-attempt.entity.js';

export interface SpotifyCredential {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope: string;
  accountId: string;
  displayName: string | null;
  reconnectRequired: boolean;
}

@Injectable()
export class SpotifyRepository {
  constructor(private readonly orm: MikroORM) {}

  async getCredential(): Promise<SpotifyCredentialEntity | null> {
    return this.orm.em.fork().findOne(SpotifyCredentialEntity, 'spotify');
  }

  async saveCredential(credential: SpotifyCredential): Promise<void> {
    await this.orm.em.fork().upsert(SpotifyCredentialEntity, {
      id: 'spotify',
      ...credential,
    });
  }

  async markReconnectRequired(): Promise<void> {
    const em = this.orm.em.fork();
    const credential = await em.findOne(SpotifyCredentialEntity, 'spotify');
    if (credential) {
      credential.reconnectRequired = true;
      await em.flush();
    }
  }

  async clearAuthorization(): Promise<void> {
    const em = this.orm.em.fork();
    await em.nativeDelete(SpotifyCredentialEntity, {});
    await em.nativeDelete(SpotifyOAuthAttemptEntity, {});
  }

  async createAttempt(attempt: {
    stateHash: string;
    codeVerifier: string;
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
  ): Promise<SpotifyOAuthAttemptEntity | null> {
    return this.orm.em.transactional(async (em) => {
      const attempt = await em.findOne(SpotifyOAuthAttemptEntity, {
        stateHash,
      });
      if (!attempt) return null;
      em.remove(attempt);
      await em.flush();
      return attempt;
    });
  }
}
