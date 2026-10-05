import { SetMetadata } from '@nestjs/common';

import { publicAuthRouteMetadata } from './auth.constants.js';

export const PublicAuthRoute = () => SetMetadata(publicAuthRouteMetadata, true);
