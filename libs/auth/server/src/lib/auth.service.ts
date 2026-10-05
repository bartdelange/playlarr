import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import {
  type AuthConfiguration,
  AuthConfigurationRepository,
  AuthSessionRepository,
} from '@playlarr/auth-persistence';

import { verifyPassword } from './password.js';

interface LoginSession {
  token: string;
  lifetimeMilliseconds: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly configurations: AuthConfigurationRepository,
    private readonly sessions: AuthSessionRepository,
  ) {}

  async isEnabled(): Promise<boolean> {
    const configuration = await this.getConfiguration();

    return configuration?.enabled ?? false;
  }

  async login(
    username: string,
    password: string,
  ): Promise<LoginSession | null> {
    const configuration = await this.getConfiguration();

    if (
      !configuration?.enabled ||
      !this.usernameMatches(username, configuration.username)
    ) {
      return null;
    }

    if (!(await verifyPassword(password, configuration.passwordHash))) {
      return null;
    }

    const token = randomBytes(32).toString('base64url');
    const lifetimeMilliseconds = configuration.sessionLifetimeSeconds * 1_000;
    const expiresAt = new Date(Date.now() + lifetimeMilliseconds);

    await this.sessions.create(this.hashToken(token), expiresAt);

    return { token, lifetimeMilliseconds };
  }

  async isAuthenticated(token: string | null): Promise<boolean> {
    const configuration = await this.getConfiguration();

    if (!configuration?.enabled) {
      return true;
    }

    return token ? this.sessions.isValid(this.hashToken(token)) : false;
  }

  async logout(token: string | null): Promise<void> {
    if (token) {
      await this.sessions.delete(this.hashToken(token));
    }
  }

  private async getConfiguration(): Promise<AuthConfiguration | null> {
    const configuration = await this.configurations.find();

    if (!configuration) {
      return null;
    }

    if (
      configuration.enabled &&
      (!configuration.username || !configuration.passwordHash)
    ) {
      throw new Error(
        'Enabled authentication requires a username and password hash',
      );
    }

    if (
      !Number.isSafeInteger(configuration.sessionLifetimeSeconds) ||
      configuration.sessionLifetimeSeconds <= 0
    ) {
      throw new Error(
        'Authentication session lifetime must be a positive integer',
      );
    }

    return configuration;
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
