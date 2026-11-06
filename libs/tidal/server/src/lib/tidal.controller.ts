import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  authCookieName,
  type AuthRequest,
  PublicAuthRoute,
  readCookie,
} from '@playlarr/auth-server';
import { tidalConfigurationInputSchema } from '@playlarr/tidal-contracts';

import { TidalService } from './tidal.service.js';

interface RedirectResponse {
  cookie(
    name: string,
    value: string,
    options: {
      httpOnly: boolean;
      maxAge: number;
      path: string;
      sameSite: 'lax';
      secure: boolean;
    },
  ): void;
  clearCookie(
    name: string,
    options: {
      httpOnly: boolean;
      path: string;
      sameSite: 'lax';
      secure: boolean;
    },
  ): void;
  redirect(location: string): void;
}

const tidalOAuthCookieName = 'playlarr_tidal_oauth';
const tidalCallbackPath = '/api/tidal/callback';

@Controller('tidal')
export class TidalController {
  constructor(private readonly tidal: TidalService) {}

  @Get('configuration')
  configuration() {
    return this.tidal.getConfiguration();
  }

  @Post('configuration')
  configure(@Body() body: unknown) {
    const parsed = tidalConfigurationInputSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(
        parsed.error.issues[0]?.message ?? 'Invalid TIDAL configuration',
      );
    return this.tidal.configure(parsed.data);
  }

  @Get('authorize')
  async authorize(
    @Query('returnTo') returnTo: string | undefined,
    @Req() request: AuthRequest,
    @Res() response: RedirectResponse,
  ) {
    const authorization = await this.tidal.createAuthorizationUrl(
      returnTo ?? '/settings',
      readCookie(request, authCookieName),
    );
    response.cookie(tidalOAuthCookieName, authorization.bindingToken, {
      httpOnly: true,
      maxAge: 10 * 60_000,
      path: tidalCallbackPath,
      sameSite: 'lax',
      secure: authorization.secureCookie,
    });
    response.redirect(authorization.url);
  }

  @Get('callback')
  @PublicAuthRoute()
  async callback(
    @Query('state') state: string | undefined,
    @Query('code') code: string | undefined,
    @Query('error') error: string | undefined,
    @Req() request: AuthRequest,
    @Res() response: RedirectResponse,
  ) {
    const bindingToken = readCookie(request, tidalOAuthCookieName);
    response.clearCookie(tidalOAuthCookieName, {
      httpOnly: true,
      path: tidalCallbackPath,
      sameSite: 'lax',
      secure: false,
    });
    response.redirect(
      await this.tidal.completeAuthorization(
        { state, code, error },
        bindingToken,
        readCookie(request, authCookieName),
      ),
    );
  }
}
