import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
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

import { TidalApiClient } from './tidal-api.client.js';
import { TidalImportService } from './tidal-import.service.js';
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
  constructor(
    private readonly tidal: TidalService,
    private readonly api: TidalApiClient,
    private readonly imports: TidalImportService,
  ) {}

  @Get('playlists')
  playlists() {
    return this.api.getPlaylists();
  }

  @Get('playlists/:playlistId/tracks')
  playlistTracks(@Param('playlistId') playlistId: string) {
    if (!playlistId || playlistId.length > 256)
      throw new BadRequestException('Invalid TIDAL playlist ID');
    return this.api.getPlaylistContents(playlistId);
  }

  @Post('imports')
  createImport(@Body() body: unknown) {
    const playlistId =
      typeof body === 'object' &&
      body !== null &&
      'playlistId' in body &&
      typeof body.playlistId === 'string'
        ? body.playlistId
        : '';
    if (!playlistId || playlistId.length > 256)
      throw new BadRequestException('Invalid TIDAL playlist ID');
    return this.imports.create(playlistId);
  }

  @Get('imports/:importId')
  getImport(@Param('importId') importId: string) {
    if (!importId || importId.length > 64)
      throw new BadRequestException('Invalid import ID');
    return this.imports.get(importId);
  }

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
