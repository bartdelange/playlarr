import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { AuthSessionRepository } from '@playlarr/auth-persistence';
import { SettingsRepository } from '@playlarr/settings-persistence';

import { type AuthSettings, authSettingsSchema } from './auth-settings.js';
import { verifyPassword } from './password.js';

interface LoginSession {
  token: string;
  lifetimeMilliseconds: number;
}

const authSettingsKey = 'auth';

@Injectable()
export class AuthService {
  constructor(
    private readonly settings: SettingsRepository,
    private readonly sessions: AuthSessionRepository,
  ) {}

  async isEnabled(): Promise<boolean> {
    const authSettings = await this.getAuthSettings();

    return authSettings?.enabled ?? false;
  }

  async login(
    username: string,
    password: string,
  ): Promise<LoginSession | null> {
    const authSettings = await this.getAuthSettings();

    if (
      !authSettings?.enabled ||
      !this.usernameMatches(username, authSettings.username)
    ) {
      return null;
    }

    if (!(await verifyPassword(password, authSettings.passwordHash))) {
      return null;
    }

    const token = randomBytes(32).toString('base64url');
    const lifetimeMilliseconds = authSettings.sessionLifetimeSeconds * 1_000;
    const expiresAt = new Date(Date.now() + lifetimeMilliseconds);

    await this.sessions.create(this.hashToken(token), expiresAt);

    return { token, lifetimeMilliseconds };
  }

  async isAuthenticated(token: string | null): Promise<boolean> {
    const authSettings = await this.getAuthSettings();

    if (!authSettings?.enabled) {
      return true;
    }

    return token ? this.sessions.isValid(this.hashToken(token)) : false;
  }

  async logout(token: string | null): Promise<void> {
    if (token) {
      await this.sessions.delete(this.hashToken(token));
    }
  }

  private async getAuthSettings(): Promise<AuthSettings | null> {
    return this.settings.get(authSettingsKey, authSettingsSchema);
  }

  private usernameMatches(username: string, expectedUsername: string): boolean {
    const actual = createHash('sha256').update(username).digest();
    const expected = createHash('sha256').update(expectedUsername).digest();

    return timingSafeEqual(actual, expected);
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
