import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { AuthSessionRepository } from '@playlarr/auth-persistence';
import { SettingsRepository } from '@playlarr/settings-persistence';

import { verifyPassword } from './password.js';

interface LoginSession {
  token: string;
  lifetimeMilliseconds: number;
}

interface AuthSettings {
  enabled: boolean;
  username: string;
  passwordHash: string;
  sessionLifetimeSeconds: number;
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
    const authSettings = await this.settings.get(authSettingsKey);

    if (!authSettings) {
      return null;
    }

    if (
      !this.isSettingsDocument(authSettings) ||
      typeof authSettings.enabled !== 'boolean' ||
      typeof authSettings.username !== 'string' ||
      typeof authSettings.passwordHash !== 'string' ||
      typeof authSettings.sessionLifetimeSeconds !== 'number'
    ) {
      throw new Error('Authentication settings are invalid');
    }

    if (
      authSettings.enabled &&
      (!authSettings.username || !authSettings.passwordHash)
    ) {
      throw new Error(
        'Enabled authentication requires a username and password hash',
      );
    }

    if (
      !Number.isSafeInteger(authSettings.sessionLifetimeSeconds) ||
      authSettings.sessionLifetimeSeconds <= 0
    ) {
      throw new Error(
        'Authentication session lifetime must be a positive integer',
      );
    }

    return {
      enabled: authSettings.enabled,
      username: authSettings.username,
      passwordHash: authSettings.passwordHash,
      sessionLifetimeSeconds: authSettings.sessionLifetimeSeconds,
    };
  }

  private isSettingsDocument(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
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
