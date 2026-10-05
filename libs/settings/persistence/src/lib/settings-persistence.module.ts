import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';

import { SettingsEntity } from './settings.entity.js';
import { SettingsRepository } from './settings.repository.js';

@Module({
  imports: [MikroOrmModule.forFeature([SettingsEntity])],
  providers: [SettingsRepository],
  exports: [SettingsRepository],
})
export class SettingsPersistenceModule {}
