import {
  createDatabase,
  migrateDatabase,
  PlaylarrDatabase,
} from '@playlarr/server-persistence';
import { loadConfig } from '@playlarr/server-config';

export interface PlaylarrRuntime {
  readonly database: PlaylarrDatabase;

  start(): Promise<void>;
  stop(): Promise<void>;
}

export const createPlaylarrRuntime = (): PlaylarrRuntime => {
  const config = loadConfig();
  let database: PlaylarrDatabase | undefined;
  let started = false;

  return {
    get database() {
      if (!database) {
        throw new Error('Playlarr runtime has not been started');
      }

      return database;
    },

    async start() {
      if (started) {
        throw new Error('Playlarr runtime already started');
      }

      await migrateDatabase(config.database);
      database = await createDatabase(config.database);

      try {
        // Todo: #119 - Implement command processor
        // commandProcessor = createCommandProcessor({ database, ... });
        // await commandProcessor.start();

        started = true;
      } catch (error) {
        await database.close();
        database = undefined;

        throw error;
      }
    },

    async stop() {
      if (!started) {
        return;
      }

      // Todo: #119 - Implement command processor
      // await commandProcessor?.stop();

      await database?.close();

      database = undefined;
      started = false;
    },
  };
};
