import { Module } from '@nestjs/common';
import { AuthPersistenceModule } from '@playlarr/auth-persistence';
import { SpotifyPersistenceModule } from '@playlarr/spotify-persistence';
import { SettingsPersistenceModule } from '@playlarr/settings-persistence';

import { SpotifyController } from './spotify.controller.js';
import { SpotifyService } from './spotify.service.js';

@Module({
  imports: [
    AuthPersistenceModule,
    SpotifyPersistenceModule,
    SettingsPersistenceModule,
  ],
  controllers: [SpotifyController],
  providers: [SpotifyService],
  exports: [SpotifyService],
})
export class SpotifyModule {}
