import { BadGatewayException, UnauthorizedException } from '@nestjs/common';
import type { TidalCredential } from '@playlarr/tidal-persistence';
import { z } from 'zod';

const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive(),
  scope: z.string().default(''),
  user_id: z.number().int().positive().transform(String).optional(),
});
const tokenErrorSchema = z.object({ error: z.string() });

export type TidalAuthorizationError =
  'authorization_expired' | 'missing_permissions' | 'provider_error';

export class TidalGrantRejectedException extends UnauthorizedException {
  constructor(readonly authorizationError: TidalAuthorizationError) {
    super('TIDAL authorization is invalid; reconnect in Settings');
  }
}

export async function requestTidalToken(body: URLSearchParams) {
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
        'invalid_scope',
        'insufficient_scope',
      ].includes(parsed.data.error)
    )
      throw new TidalGrantRejectedException(
        parsed.data.error === 'invalid_grant' ||
          parsed.data.error === 'access_denied'
          ? 'authorization_expired'
          : parsed.data.error === 'invalid_scope' ||
              parsed.data.error === 'insufficient_scope'
            ? 'missing_permissions'
            : 'provider_error',
      );
    throw new BadGatewayException('TIDAL token service is unavailable');
  }
  const parsed = tokenSchema.safeParse(await response.json());
  if (!parsed.success)
    throw new BadGatewayException('TIDAL returned an invalid token response');
  return parsed.data;
}

export function updatedTidalCredential(
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
