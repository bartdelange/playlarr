import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { spotifyConfigurationInputSchema } from '@playlarr/spotify-contracts';
import { PublicAuthRoute } from '@playlarr/auth-server';

import { SpotifyService } from './spotify.service.js';

interface RedirectResponse {
  redirect(location: string): void;
}

@Controller('spotify')
export class SpotifyController {
  constructor(private readonly spotify: SpotifyService) {}

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
    @Res() response: RedirectResponse,
  ) {
    response.redirect(
      await this.spotify.createAuthorizationUrl(returnTo ?? '/settings'),
    );
  }

  @Get('callback')
  @PublicAuthRoute()
  async callback(
    @Query('state') state: string | undefined,
    @Query('code') code: string | undefined,
    @Query('error') error: string | undefined,
    @Res() response: RedirectResponse,
  ) {
    response.redirect(
      await this.spotify.completeAuthorization({ state, code, error }),
    );
  }
}
