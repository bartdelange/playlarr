import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { Injectable, UnauthorizedException } from '@nestjs/common';

import {
  AuthSessionRepository,
  AuthStateRepository,
} from '@playlarr/auth-persistence';
import { SettingsRepository } from '@playlarr/settings-persistence';

import { type AuthSettings, authSettingsSchema } from './auth-settings.js';
import { hashPassword, verifyPassword } from './password.js';

interface LoginSession {
  token: string;
  lifetimeMilliseconds: number;
}

interface PersistedSession extends LoginSession {
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
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
  private mutationTail = Promise.resolve();

  constructor(
    private readonly settings: SettingsRepository,
    private readonly sessions: AuthSessionRepository,
    private readonly authState: AuthStateRepository,
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
    token: string | null,
  ): Promise<AuthConfigurationResult | null> {
    return this.serializeMutation(async () => {
      const current = await this.getAuthSettings();

      if (
        current?.enabled &&
        (!token || !(await this.sessions.isValid(this.hashToken(token))))
      ) {
        throw new UnauthorizedException();
      }

      if (!input.enabled) {
        const nextSettings: AuthSettings = {
          enabled: false,
          username: input.username,
          passwordHash: current?.passwordHash ?? '',
          sessionLifetimeSeconds: current?.sessionLifetimeSeconds ?? 2_592_000,
        };

        await this.authState.replaceConfiguration(nextSettings, null);

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

      const sessionLifetimeSeconds =
        current?.sessionLifetimeSeconds ?? 2_592_000;
      const nextSettings: AuthSettings = {
        enabled: true,
        username: input.username,
        passwordHash,
        sessionLifetimeSeconds,
      };
      const session = this.createSession(sessionLifetimeSeconds);

      await this.authState.replaceConfiguration(nextSettings, session);

      return {
        configuration: { enabled: true, username: input.username },
        session: this.publicSession(session),
      };
    });
  }

  async login(
    username: string,
    password: string,
  ): Promise<LoginSession | null> {
    return this.serializeMutation(async () => {
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

      const session = this.createSession(authSettings.sessionLifetimeSeconds);

      await this.sessions.create(session.tokenHash, session.expiresAt);

      return this.publicSession(session);
    });
  }

  async isAuthenticated(token: string | null): Promise<boolean> {
    const authSettings = await this.getAuthSettings();

    if (!authSettings?.enabled) {
      return true;
    }

    return token ? this.sessions.isValid(this.hashToken(token)) : false;
  }

  async hasActiveSession(token: string | null): Promise<boolean> {
    const authSettings = await this.getAuthSettings();

    return Boolean(
      authSettings?.enabled &&
      token &&
      (await this.sessions.isValid(this.hashToken(token))),
    );
  }

  async logout(token: string | null): Promise<void> {
    if (token) {
      await this.sessions.delete(this.hashToken(token));
    }
  }

  private async getAuthSettings(): Promise<AuthSettings | null> {
    return this.settings.get(authSettingsKey, authSettingsSchema);
  }

  private createSession(lifetimeSeconds: number): PersistedSession {
    const token = randomBytes(32).toString('base64url');
    const lifetimeMilliseconds = lifetimeSeconds * 1_000;
    const expiresAt = new Date(Date.now() + lifetimeMilliseconds);

    return {
      token,
      tokenHash: this.hashToken(token),
      lifetimeMilliseconds,
      expiresAt,
      createdAt: new Date(),
    };
  }

  private publicSession(session: PersistedSession): LoginSession {
    return {
      token: session.token,
      lifetimeMilliseconds: session.lifetimeMilliseconds,
    };
  }

  private async serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTail;
    let release: () => void = () => undefined;

    this.mutationTail = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;

    try {
      return await operation();
    } finally {
      release();
    }
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
