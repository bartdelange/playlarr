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
import { spotifyConfigurationInputSchema } from '@playlarr/spotify-contracts';
import {
  authCookieName,
  type AuthRequest,
  PublicAuthRoute,
  readCookie,
} from '@playlarr/auth-server';

import { SpotifyService } from './spotify.service.js';
import { SpotifyApiClient } from './spotify-api.client.js';

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

const spotifyOAuthCookieName = 'playlarr_spotify_oauth';
const spotifyCallbackPath = '/api/spotify/callback';

@Controller('spotify')
export class SpotifyController {
  constructor(
    private readonly spotify: SpotifyService,
    private readonly api: SpotifyApiClient,
  ) {}

  @Get('playlists')
  playlists() {
    return this.api.getPlaylists();
  }

  @Get('playlists/:playlistId/tracks')
  playlistTracks(@Param('playlistId') playlistId: string) {
    if (!playlistId || playlistId.length > 256)
      throw new BadRequestException('Invalid Spotify playlist ID');
    return this.api.getPlaylistContents(playlistId);
  }

  @Get('configuration')
  configuration() {
    return this.spotify.getConfiguration();
  }

  @Post('configuration')
  configure(@Body() body: unknown) {
    const parsed = spotifyConfigurationInputSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(
        parsed.error.issues[0]?.message ?? 'Invalid Spotify configuration',
      );
    return this.spotify.configure(parsed.data);
  }

  @Get('authorize')
  async authorize(
    @Query('returnTo') returnTo: string | undefined,
    @Req() request: AuthRequest,
    @Res() response: RedirectResponse,
  ) {
    const authorization = await this.spotify.createAuthorizationUrl(
      returnTo ?? '/settings',
      readCookie(request, authCookieName),
    );
    response.cookie(spotifyOAuthCookieName, authorization.bindingToken, {
      httpOnly: true,
      maxAge: 10 * 60_000,
      path: spotifyCallbackPath,
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
    const bindingToken = readCookie(request, spotifyOAuthCookieName);
    response.clearCookie(spotifyOAuthCookieName, {
      httpOnly: true,
      path: spotifyCallbackPath,
      sameSite: 'lax',
      secure: false,
    });
    response.redirect(
      await this.spotify.completeAuthorization(
        { state, code, error },
        bindingToken,
        readCookie(request, authCookieName),
      ),
    );
  }
}
