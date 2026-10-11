import { registerAs } from '@nestjs/config';

export interface AppConfig {
  database: {
    path: string;
  };
  publicOrigin?: string;
  server: {
    host: string;
    port: number;
  };
}

export const appConfig = registerAs('app', (): AppConfig => ({
  database: {
    path: process.env['PLAYLARR_DATABASE_PATH'] ?? './data/playlarr.db',
  },
  publicOrigin: process.env['PLAYLARR_PUBLIC_ORIGIN'],
  server: {
    host: process.env['PLAYLARR_SERVER_HOST'] ?? '0.0.0.0',
    port: Number(process.env['PLAYLARR_SERVER_PORT'] ?? 3001),
  },
}));
