import { Module } from '@nestjs/common';
import { AuthModule } from '@playlarr/auth-server';
import { SettingsPersistenceModule } from '@playlarr/settings-persistence';
import { TidalPersistenceModule } from '@playlarr/tidal-persistence';

import { TidalController } from './tidal.controller.js';
import { TidalApiClient } from './tidal-api.client.js';
import { TidalImportService } from './tidal-import.service.js';
import { TidalService } from './tidal.service.js';

@Module({
  imports: [AuthModule, SettingsPersistenceModule, TidalPersistenceModule],
  controllers: [TidalController],
  providers: [TidalService, TidalApiClient, TidalImportService],
  exports: [TidalService, TidalApiClient],
})
export class TidalModule {}
