import { loadConfig } from "./config/environment";
import { openDatabase } from "./persistence/database";
import { SettingsRepository } from "./persistence/settings-repository";
import { WebSecurity } from "./security/web-security";
const config = loadConfig();
const database = openDatabase(config.databasePath);
export const settings = new SettingsRepository(database);
export const security = new WebSecurity(settings);
export { config, database };
