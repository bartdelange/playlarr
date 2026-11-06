import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';

import { TidalCredentialEntity } from './tidal-credential.entity.js';
import { TidalOAuthAttemptEntity } from './tidal-oauth-attempt.entity.js';
import { TidalRepository } from './tidal.repository.js';

@Module({
  imports: [
    MikroOrmModule.forFeature([TidalCredentialEntity, TidalOAuthAttemptEntity]),
  ],
  providers: [TidalRepository],
  exports: [TidalRepository],
})
export class TidalPersistenceModule {}
