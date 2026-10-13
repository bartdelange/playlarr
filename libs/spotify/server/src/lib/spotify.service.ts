import { createHash, randomBytes, randomUUID } from 'node:crypto';

import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  SpotifyConfiguration,
  SpotifyConfigurationInput,
} from '@playlarr/spotify-contracts';
import { AuthService } from '@playlarr/auth-server';
import {
  SpotifyRepository,
  type SpotifyCredential,
} from '@playlarr/spotify-persistence';
import { SettingsRepository } from '@playlarr/settings-persistence';
import { z } from 'zod';

import {
  spotifySettingsKey,
  spotifySettingsSchema,
  type SpotifySettings,
} from './spotify-settings.js';

const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive(),
  scope: z.string().default(''),
});
const profileSchema = z.object({
  account_id: z.string().optional(),
  id: z.string(),
  display_name: z.string().nullable().default(null),
});
const tokenErrorSchema = z.object({ error: z.string() });
const spotifyScopes =
  'playlist-read-private playlist-read-collaborative user-read-private';

interface AuthorizationStart {
  bindingToken: string;
  secureCookie: boolean;
  url: string;
}

class SpotifyGrantRejectedException extends UnauthorizedException {}

@Injectable()
export class SpotifyService {
  private mutationTail = Promise.resolve();

  constructor(
    private readonly settings: SettingsRepository,
    private readonly spotify: SpotifyRepository,
    private readonly auth: AuthService,
  ) {}

  async getConfiguration(): Promise<SpotifyConfiguration> {
    const [settings, credential] = await Promise.all([
      this.getSettings(),
      this.spotify.getCredential(),
    ]);
    if (!settings) {
      return {
        clientId: '',
        redirectUri: '',
        clientSecretConfigured: false,
        status: 'not_configured',
        account: null,
      };
    }
    return {
      clientId: settings.clientId,
      redirectUri: settings.redirectUri,
      clientSecretConfigured: true,
      status: !credential
        ? 'not_connected'
        : credential.reconnectRequired
          ? 'reconnect_required'
          : 'connected',
      account: credential
        ? { id: credential.accountId, displayName: credential.displayName }
        : null,
    };
  }

  async configure(
    input: SpotifyConfigurationInput,
  ): Promise<SpotifyConfiguration> {
    return this.serialize(async () => {
      const current = await this.getSettings();
      const clientSecret = input.clientSecret ?? current?.clientSecret;
      if (!clientSecret)
        throw new BadRequestException('clientSecret is required');
      const nextWithoutRevision = {
        clientId: input.clientId,
        clientSecret,
        redirectUri: input.redirectUri,
      };
      const changed =
        !current ||
        Object.entries(nextWithoutRevision).some(
          ([key, value]) => current[key as keyof SpotifySettings] !== value,
        );
      if (changed) {
        await this.spotify.replaceConfiguration({
          ...nextWithoutRevision,
          revision: randomUUID(),
        });
      }
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
    const safeReturnPath = this.safeReturnPath(returnPath);
    const state = randomBytes(32).toString('base64url');
    const bindingToken = randomBytes(32).toString('base64url');
    const codeVerifier = randomBytes(64).toString('base64url');
    const codeChallenge = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    await this.spotify.createAttempt({
      stateHash: this.hash(state),
      codeVerifier,
      bindingHash: this.hash(bindingToken),
      authSessionHash:
        authEnabled && authSessionToken ? this.hash(authSessionToken) : null,
      configurationRevision: settings.revision,
      returnPath: safeReturnPath,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
    const url = new URL('https://accounts.spotify.com/authorize');
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: settings.clientId,
      scope: spotifyScopes,
      redirect_uri: settings.redirectUri,
      state,
      code_challenge_method: 'S256',
      code_challenge: codeChallenge,
    }).toString();
    return {
      bindingToken,
      secureCookie: new URL(settings.redirectUri).protocol === 'https:',
      url: url.toString(),
    };
  }

  async completeAuthorization(
    input: {
      state?: string;
      code?: string;
      error?: string;
    },
    bindingToken: string | null,
    authSessionToken: string | null,
  ): Promise<string> {
    if (!input.state)
      throw new BadRequestException('Spotify authorization state is missing');
    if (!bindingToken)
      throw new BadRequestException('Spotify authorization session is missing');
    const attempt = await this.spotify.consumeAttempt(
      this.hash(input.state),
      this.hash(bindingToken),
    );
    if (!attempt || attempt.expiresAt <= new Date())
      throw new BadRequestException(
        'Spotify authorization session is invalid or expired',
      );
    if (
      !(await this.ownsAuthorizationAttempt(
        attempt.authSessionHash,
        authSessionToken,
      ))
    )
      throw new BadRequestException(
        'Spotify authorization belongs to a different or expired Playlarr session',
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
      settings,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: input.code,
        redirect_uri: settings.redirectUri,
        code_verifier: attempt.codeVerifier,
      }),
    );
    if (!token.refresh_token)
      throw new BadGatewayException('Spotify did not return a refresh token');
    const profile = await this.requestProfile(token.access_token);
    if (!profile)
      return this.resultPath(attempt.returnPath, 'error', 'provider_error');
    const saved = await this.spotify.saveCredentialIfConfigurationCurrent(
      {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: new Date(Date.now() + token.expires_in * 1_000),
        scope: token.scope,
        accountId: profile.account_id ?? profile.id,
        displayName: profile.display_name,
        reconnectRequired: false,
      },
      attempt.configurationRevision,
    );
    if (!saved)
      return this.resultPath(
        attempt.returnPath,
        'error',
        'configuration_changed',
      );
    return this.resultPath(attempt.returnPath, 'connected');
  }

  async getAccessToken(): Promise<string> {
    const credential = await this.spotify.getCredential();
    if (!credential || credential.reconnectRequired)
      throw new UnauthorizedException('Reconnect Spotify in Settings');
    if (credential.expiresAt.getTime() > Date.now() + 30_000)
      return credential.accessToken;
    return this.refreshAccessToken();
  }

  async getCurrentUser(): Promise<{ id: string; displayName: string | null }> {
    const accessToken = await this.getAccessToken();
    let profile = await this.requestProfile(accessToken);
    if (!profile) {
      const refreshedToken = await this.refreshAccessToken(accessToken);
      profile = await this.requestProfile(refreshedToken);
      if (!profile) {
        throw new UnauthorizedException(
          'Spotify rejected the refreshed access token',
        );
      }
    }
    return {
      id: profile.account_id ?? profile.id,
      displayName: profile.display_name,
    };
  }

  private refreshAccessToken(failedAccessToken?: string): Promise<string> {
    return this.serialize(async () => {
      const latest = await this.spotify.getCredential();
      if (!latest || latest.reconnectRequired)
        throw new UnauthorizedException('Reconnect Spotify in Settings');
      if (
        failedAccessToken !== undefined &&
        latest.accessToken !== failedAccessToken
      )
        return latest.accessToken;
      if (
        failedAccessToken === undefined &&
        latest.expiresAt.getTime() > Date.now() + 30_000
      )
        return latest.accessToken;
      const settings = await this.requireSettings();
      try {
        const token = await this.requestToken(
          settings,
          new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: latest.refreshToken,
          }),
        );
        const saved = await this.spotify.saveCredentialIfConfigurationCurrent(
          this.updatedCredential(latest, token),
          settings.revision,
        );
        if (!saved)
          throw new UnauthorizedException(
            'Spotify configuration changed; authorize again in Settings',
          );
        return token.access_token;
      } catch (error) {
        if (error instanceof SpotifyGrantRejectedException)
          await this.spotify.markReconnectRequiredIfCurrent(latest.revision);
        throw error;
      }
    });
  }

  private updatedCredential(
    current: SpotifyCredential,
    token: z.infer<typeof tokenSchema>,
  ): SpotifyCredential {
    return {
      ...current,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? current.refreshToken,
      expiresAt: new Date(Date.now() + token.expires_in * 1_000),
      scope: token.scope || current.scope,
      reconnectRequired: false,
    };
  }

  private async requestToken(
    settings: SpotifySettings,
    body: URLSearchParams,
  ): Promise<z.infer<typeof tokenSchema>> {
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${settings.clientId}:${settings.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!response.ok) {
      const errorResponse = tokenErrorSchema.safeParse(
        await response.json().catch(() => null),
      );
      if (errorResponse.success && errorResponse.data.error === 'invalid_grant')
        throw new SpotifyGrantRejectedException(
          'Spotify authorization is invalid; reconnect in Settings',
        );
      throw new BadGatewayException('Spotify token service is unavailable');
    }
    const parsed = tokenSchema.safeParse(await response.json());
    if (!parsed.success)
      throw new BadGatewayException(
        'Spotify returned an invalid token response',
      );
    return parsed.data;
  }

  private async requestProfile(accessToken: string) {
    const response = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.status === 401) {
      return null;
    }
    if (!response.ok)
      throw new BadGatewayException('Spotify profile is unavailable');
    const parsed = profileSchema.safeParse(await response.json());
    if (!parsed.success)
      throw new BadGatewayException('Spotify returned an invalid profile');
    return parsed.data;
  }

  private getSettings() {
    return this.settings.get(spotifySettingsKey, spotifySettingsSchema);
  }
  private async requireSettings() {
    const settings = await this.getSettings();
    if (!settings)
      throw new BadRequestException('Configure Spotify in Settings first');
    return settings;
  }
  private hash(value: string) {
    // These inputs are high-entropy random bearer tokens, not passwords; a fast
    // one-way lookup hash is intentional and does not need password stretching.
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
    url.searchParams.set('spotify', status);
    if (error) url.searchParams.set('spotify_error', error);
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
