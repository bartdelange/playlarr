import { createHash, randomBytes, randomUUID } from 'node:crypto';

import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '@playlarr/auth-server';
import type {
  TidalConfiguration,
  TidalConfigurationInput,
} from '@playlarr/tidal-contracts';
import {
  TidalRepository,
  type TidalCredential,
} from '@playlarr/tidal-persistence';
import { SettingsRepository } from '@playlarr/settings-persistence';
import { z } from 'zod';

import {
  tidalSettingsKey,
  tidalSettingsSchema,
  type TidalSettings,
} from './tidal-settings.js';

const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive(),
  scope: z.string().default(''),
  user_id: z.string().optional(),
});
const tokenErrorSchema = z.object({ error: z.string() });
const tidalScopes = 'user.read playlists.read';

interface AuthorizationStart {
  bindingToken: string;
  secureCookie: boolean;
  url: string;
}

class TidalGrantRejectedException extends UnauthorizedException {}

@Injectable()
export class TidalService {
  private mutationTail = Promise.resolve();

  constructor(
    private readonly settings: SettingsRepository,
    private readonly tidal: TidalRepository,
    private readonly auth: AuthService,
  ) {}

  async getConfiguration(): Promise<TidalConfiguration> {
    const [settings, credential] = await Promise.all([
      this.getSettings(),
      this.tidal.getCredential(),
    ]);
    if (!settings)
      return {
        clientId: '',
        redirectUri: '',
        status: 'not_configured',
        account: null,
      };
    return {
      clientId: settings.clientId,
      redirectUri: settings.redirectUri,
      status: !credential
        ? 'not_connected'
        : credential.reconnectRequired
          ? 'reconnect_required'
          : 'connected',
      account: credential ? { id: credential.accountId } : null,
    };
  }

  configure(input: TidalConfigurationInput): Promise<TidalConfiguration> {
    return this.serialize(async () => {
      const current = await this.getSettings();
      const changed =
        !current ||
        current.clientId !== input.clientId ||
        current.redirectUri !== input.redirectUri;
      if (changed)
        await this.tidal.replaceConfiguration({
          ...input,
          revision: randomUUID(),
        });
      return this.getConfiguration();
    });
  }

  async createAuthorizationUrl(
    returnPath: string,
    authSessionToken: string | null,
  ): Promise<AuthorizationStart> {
    const settings = await this.requireSettings();
    const authEnabled = await this.auth.isEnabled();
    if (authEnabled && !authSessionToken) throw new UnauthorizedException();
    const state = randomBytes(32).toString('base64url');
    const bindingToken = randomBytes(32).toString('base64url');
    const codeVerifier = randomBytes(64).toString('base64url');
    const codeChallenge = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    await this.tidal.createAttempt({
      stateHash: this.hash(state),
      codeVerifier,
      bindingHash: this.hash(bindingToken),
      authSessionHash:
        authEnabled && authSessionToken ? this.hash(authSessionToken) : null,
      configurationRevision: settings.revision,
      returnPath: this.safeReturnPath(returnPath),
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
    const url = new URL('https://login.tidal.com/authorize');
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: settings.clientId,
      redirect_uri: settings.redirectUri,
      scope: tidalScopes,
      code_challenge_method: 'S256',
      code_challenge: codeChallenge,
      state,
    }).toString();
    return {
      bindingToken,
      secureCookie: new URL(settings.redirectUri).protocol === 'https:',
      url: url.toString(),
    };
  }

  async completeAuthorization(
    input: { state?: string; code?: string; error?: string },
    bindingToken: string | null,
    authSessionToken: string | null,
  ): Promise<string> {
    if (!input.state)
      throw new BadRequestException('TIDAL authorization state is missing');
    if (!bindingToken)
      throw new BadRequestException('TIDAL authorization session is missing');
    const attempt = await this.tidal.consumeAttempt(
      this.hash(input.state),
      this.hash(bindingToken),
    );
    if (!attempt || attempt.expiresAt <= new Date())
      throw new BadRequestException(
        'TIDAL authorization session is invalid or expired',
      );
    if (
      !(await this.ownsAuthorizationAttempt(
        attempt.authSessionHash,
        authSessionToken,
      ))
    )
      throw new BadRequestException(
        'TIDAL authorization belongs to a different or expired Playlarr session',
      );
    if (input.error)
      return this.resultPath(
        attempt.returnPath,
        'error',
        input.error === 'access_denied' ? 'access_denied' : 'provider_error',
      );
    if (!input.code)
      return this.resultPath(attempt.returnPath, 'error', 'missing_code');

    const settings = await this.requireSettings();
    if (settings.revision !== attempt.configurationRevision)
      return this.resultPath(
        attempt.returnPath,
        'error',
        'configuration_changed',
      );
    const token = await this.requestToken(
      new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: settings.clientId,
        code: input.code,
        redirect_uri: settings.redirectUri,
        code_verifier: attempt.codeVerifier,
      }),
    );
    if (!token.refresh_token)
      throw new BadGatewayException('TIDAL did not return a refresh token');
    const accountId =
      token.user_id ?? this.accountIdFromToken(token.access_token);
    if (!accountId)
      throw new BadGatewayException(
        'TIDAL did not identify the authorized account',
      );
    const saved = await this.tidal.saveCredentialIfConfigurationCurrent(
      {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: new Date(Date.now() + token.expires_in * 1_000),
        scope: token.scope,
        accountId,
        reconnectRequired: false,
      },
      attempt.configurationRevision,
    );
    return saved
      ? this.resultPath(attempt.returnPath, 'connected')
      : this.resultPath(attempt.returnPath, 'error', 'configuration_changed');
  }

  async getAccessToken(): Promise<string> {
    const credential = await this.tidal.getCredential();
    if (!credential || credential.reconnectRequired)
      throw new UnauthorizedException('Reconnect TIDAL in Settings');
    if (credential.expiresAt.getTime() > Date.now() + 60_000)
      return credential.accessToken;
    return this.refreshAccessToken();
  }

  refreshRejectedAccessToken(failedAccessToken: string): Promise<string> {
    return this.refreshAccessToken(failedAccessToken);
  }

  private refreshAccessToken(failedAccessToken?: string): Promise<string> {
    return this.serialize(async () => {
      const latest = await this.tidal.getCredential();
      if (!latest || latest.reconnectRequired)
        throw new UnauthorizedException('Reconnect TIDAL in Settings');
      if (
        failedAccessToken !== undefined &&
        latest.accessToken !== failedAccessToken
      )
        return latest.accessToken;
      if (
        failedAccessToken === undefined &&
        latest.expiresAt.getTime() > Date.now() + 60_000
      )
        return latest.accessToken;
      const settings = await this.requireSettings();
      try {
        const token = await this.requestToken(
          new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: latest.refreshToken,
          }),
        );
        const saved = await this.tidal.saveRefreshedCredentialIfCurrent(
          this.updatedCredential(latest, token),
          settings.revision,
          latest.revision,
        );
        if (!saved) {
          const current = await this.tidal.getCredential();
          if (current && !current.reconnectRequired) return current.accessToken;
          throw new UnauthorizedException(
            'TIDAL configuration changed; authorize again in Settings',
          );
        }
        return token.access_token;
      } catch (error) {
        if (error instanceof TidalGrantRejectedException) {
          const marked = await this.tidal.markReconnectRequiredIfCurrent(
            latest.revision,
          );
          if (!marked) {
            const current = await this.tidal.getCredential();
            if (current && !current.reconnectRequired)
              return current.accessToken;
          }
        }
        throw error;
      }
    });
  }

  private updatedCredential(
    current: TidalCredential,
    token: z.infer<typeof tokenSchema>,
  ): TidalCredential {
    return {
      ...current,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? current.refreshToken,
      expiresAt: new Date(Date.now() + token.expires_in * 1_000),
      scope: token.scope || current.scope,
      reconnectRequired: false,
    };
  }

  private async requestToken(body: URLSearchParams) {
    const response = await fetch('https://auth.tidal.com/v1/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) {
      const parsed = tokenErrorSchema.safeParse(
        await response.json().catch(() => null),
      );
      if (
        parsed.success &&
        [
          'access_denied',
          'invalid_client',
          'invalid_grant',
          'invalid_request',
        ].includes(parsed.data.error)
      )
        throw new TidalGrantRejectedException(
          'TIDAL authorization is invalid; reconnect in Settings',
        );
      throw new BadGatewayException('TIDAL token service is unavailable');
    }
    const parsed = tokenSchema.safeParse(await response.json());
    if (!parsed.success)
      throw new BadGatewayException('TIDAL returned an invalid token response');
    return parsed.data;
  }

  private accountIdFromToken(token: string): string | null {
    const payload = token.split('.')[1];
    if (!payload) return null;
    try {
      const parsed = z
        .object({ sub: z.string().min(1) })
        .safeParse(JSON.parse(Buffer.from(payload, 'base64url').toString()));
      return parsed.success ? parsed.data.sub : null;
    } catch {
      return null;
    }
  }

  private getSettings() {
    return this.settings.get(tidalSettingsKey, tidalSettingsSchema);
  }

  private async requireSettings(): Promise<TidalSettings> {
    const settings = await this.getSettings();
    if (!settings)
      throw new BadRequestException('Configure TIDAL in Settings first');
    return settings;
  }

  private hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private async ownsAuthorizationAttempt(
    expectedSessionHash: string | null,
    sessionToken: string | null,
  ): Promise<boolean> {
    if (!expectedSessionHash) return !(await this.auth.isEnabled());
    return (
      sessionToken !== null &&
      this.hash(sessionToken) === expectedSessionHash &&
      (await this.auth.hasActiveSession(sessionToken))
    );
  }

  private safeReturnPath(value: string) {
    return value.startsWith('/') && !value.startsWith('//')
      ? value
      : '/settings';
  }

  private resultPath(path: string, status: string, error?: string) {
    const url = new URL(path, 'http://playlarr.local');
    url.searchParams.set('tidal', status);
    if (error) url.searchParams.set('tidal_error', error);
    return `${url.pathname}${url.search}${url.hash}`;
  }

  private async serialize<T>(operation: () => Promise<T>): Promise<T> {
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
}
