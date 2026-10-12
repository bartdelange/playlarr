import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { AuthSessionRepository } from '@playlarr/auth-persistence';
import { SettingsRepository } from '@playlarr/settings-persistence';

import { type AuthSettings, authSettingsSchema } from './auth-settings.js';
import { hashPassword, verifyPassword } from './password.js';

interface LoginSession {
  token: string;
  lifetimeMilliseconds: number;
}

export interface AuthConfiguration {
  enabled: boolean;
  username: string;
}

interface AuthConfigurationInput {
  enabled: boolean;
  username: string;
  password?: string;
}

interface AuthConfigurationResult {
  configuration: AuthConfiguration;
  session: LoginSession | null;
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

  async getConfiguration(): Promise<AuthConfiguration> {
    const authSettings = await this.getAuthSettings();

    return {
      enabled: authSettings?.enabled ?? false,
      username: authSettings?.username ?? '',
    };
  }

  async configure(
    input: AuthConfigurationInput,
  ): Promise<AuthConfigurationResult | null> {
    const current = await this.getAuthSettings();

    if (!input.enabled) {
      await this.settings.set(authSettingsKey, {
        enabled: false,
        username: input.username,
        passwordHash: current?.passwordHash ?? '',
        sessionLifetimeSeconds: current?.sessionLifetimeSeconds ?? 2_592_000,
      });
      await this.sessions.deleteAll();

      return {
        configuration: { enabled: false, username: input.username },
        session: null,
      };
    }

    if (!input.password && !current?.enabled) {
      return null;
    }

    const passwordHash = input.password
      ? await hashPassword(input.password)
      : current?.passwordHash;

    if (!passwordHash) {
      return null;
    }

    const sessionLifetimeSeconds = current?.sessionLifetimeSeconds ?? 2_592_000;

    await this.settings.set(authSettingsKey, {
      enabled: true,
      username: input.username,
      passwordHash,
      sessionLifetimeSeconds,
    });
    await this.sessions.deleteAll();

    return {
      configuration: { enabled: true, username: input.username },
      session: await this.createSession(sessionLifetimeSeconds),
    };
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

    return this.createSession(authSettings.sessionLifetimeSeconds);
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

  private async createSession(lifetimeSeconds: number): Promise<LoginSession> {
    const token = randomBytes(32).toString('base64url');
    const lifetimeMilliseconds = lifetimeSeconds * 1_000;
    const expiresAt = new Date(Date.now() + lifetimeMilliseconds);

    await this.sessions.create(this.hashToken(token), expiresAt);

    return { token, lifetimeMilliseconds };
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
