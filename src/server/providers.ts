import { spotifyProvider, tidalProvider } from "./integrations/sources";
import { config, settings } from "./runtime";
let spotifyInstance: ReturnType<typeof spotifyProvider> | undefined;
let tidalInstance: ReturnType<typeof tidalProvider> | undefined;
export const spotify = () =>
  (spotifyInstance ??= spotifyProvider(config, settings));
export const tidal = () => (tidalInstance ??= tidalProvider(config, settings));
