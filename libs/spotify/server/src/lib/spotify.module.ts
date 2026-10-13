import { Module } from '@nestjs/common';
import { AuthModule } from '@playlarr/auth-server';
import { SpotifyPersistenceModule } from '@playlarr/spotify-persistence';
import { SettingsPersistenceModule } from '@playlarr/settings-persistence';

import { SpotifyController } from './spotify.controller.js';
import { SpotifyApiClient } from './spotify-api.client.js';
import { SpotifyImportService } from './spotify-import.service.js';
import { SpotifyService } from './spotify.service.js';

@Module({
  imports: [AuthModule, SpotifyPersistenceModule, SettingsPersistenceModule],
  controllers: [SpotifyController],
  providers: [SpotifyService, SpotifyApiClient, SpotifyImportService],
  exports: [SpotifyService, SpotifyApiClient],
})
export class SpotifyModule {}
