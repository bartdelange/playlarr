import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AuthSessionRepository } from '@playlarr/auth-persistence';

import { verifyPassword } from './password.js';

interface AuthConfiguration {
  enabled: boolean;
  username: string;
  passwordHash: string;
  sessionLifetimeSeconds: number;
}

@Injectable()
export class AuthService {
  private readonly configuration: AuthConfiguration;

  constructor(
    config: ConfigService,
    private readonly sessions: AuthSessionRepository,
  ) {
    this.configuration = config.getOrThrow<AuthConfiguration>('app.auth');

    if (
      this.configuration.enabled &&
      (!this.configuration.username || !this.configuration.passwordHash)
    ) {
      throw new Error(
        'Authentication requires PLAYLARR_AUTH_USERNAME and PLAYLARR_AUTH_PASSWORD_HASH',
      );
    }

    if (
      !Number.isSafeInteger(this.configuration.sessionLifetimeSeconds) ||
      this.configuration.sessionLifetimeSeconds <= 0
    ) {
      throw new Error(
        'Authentication session lifetime must be a positive integer',
      );
    }
  }

  get enabled(): boolean {
    return this.configuration.enabled;
  }

  get sessionLifetimeMilliseconds(): number {
    return this.configuration.sessionLifetimeSeconds * 1_000;
  }

  async login(username: string, password: string): Promise<string | null> {
    if (!this.enabled || !this.usernameMatches(username)) {
      return null;
    }

    if (!(await verifyPassword(password, this.configuration.passwordHash))) {
      return null;
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.sessionLifetimeMilliseconds);

    await this.sessions.create(this.hashToken(token), expiresAt);

    return token;
  }

  async isAuthenticated(token: string | null): Promise<boolean> {
    if (!this.enabled) {
      return true;
    }

    return token ? this.sessions.isValid(this.hashToken(token)) : false;
  }

  async logout(token: string | null): Promise<void> {
    if (token) {
      await this.sessions.delete(this.hashToken(token));
    }
  }

  private usernameMatches(username: string): boolean {
    const actual = createHash('sha256').update(username).digest();
    const expected = createHash('sha256')
      .update(this.configuration.username)
      .digest();

    return timingSafeEqual(actual, expected);
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
