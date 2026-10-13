import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';

import { SpotifyCredentialEntity } from './spotify-credential.entity.js';
import { SpotifyOAuthAttemptEntity } from './spotify-oauth-attempt.entity.js';
import { SpotifyRepository } from './spotify.repository.js';

@Module({
  imports: [
    MikroOrmModule.forFeature([
      SpotifyCredentialEntity,
      SpotifyOAuthAttemptEntity,
    ]),
  ],
  providers: [SpotifyRepository],
  exports: [SpotifyRepository],
})
export class SpotifyPersistenceModule {}
