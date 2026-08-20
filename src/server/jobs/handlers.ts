import type Database from "better-sqlite3";
import { executeApprovedPlan } from "../application/lidarr-execution";
import type { AppConfig } from "../config/environment";
import { LidarrClient } from "../integrations/lidarr/client";
import { spotifyProvider, tidalProvider } from "../integrations/sources";
import { MusicBrainzClient } from "../integrations/musicbrainz/client";
import { MusicBrainzResolver } from "../integrations/musicbrainz/orchestrator";
import { ImportRepository } from "../persistence/import-repository";
import { JobRepository } from "../persistence/job-repository";
import { LidarrPlanRepository } from "../persistence/lidarr-plan-repository";
import { ResolutionRepository } from "../persistence/resolution-repository";
import type { SettingsRepository } from "../persistence/settings-repository";
import type { JobHandler } from "./worker";

export function productionJobHandlers(database: Database.Database, config: AppConfig, settings: SettingsRepository): Record<string, JobHandler> {
  const value = <T>(key: string, fallback: T) => settings.get(key, fallback);
  const resolution: JobHandler = async (job, progress, cancelled) => {
    if (!job.importId) throw new Error("resolution job has no import");
    const imports = new ImportRepository(database); const entries = imports.entries(job.importId); let unresolved = false;
    const resolver = new MusicBrainzResolver(new MusicBrainzClient({ baseUrl: config.musicBrainz.baseUrl, userAgent: value("mb_user_agent", config.musicBrainz.userAgent), requestDelayMs: config.musicBrainz.requestDelay * 1000, timeoutMs: config.musicBrainz.timeout * 1000, maxRetries: config.musicBrainz.maxRetries }));
    const resolutions = new ResolutionRepository(database);
    for (const [index, entry] of entries.entries()) {
      if (cancelled()) return;
      if (entry.resolutionState === "skipped" || entry.isManual) { progress(index + 1, entries.length, entry.track.title); continue; }
      resolutions.markResolving(entry.id); const result = await resolver.resolve(entry.track); unresolved ||= !result.resolvedVia; resolutions.saveAutomatic(entry.id, result); progress(index + 1, entries.length, entry.track.title);
    }
    imports.setWorkflowState(job.importId, unresolved ? "review_required" : "ready_to_plan");
  };
  const lidarrExecution: JobHandler = async (job) => {
    const planId = String(job.payload?.planId ?? ""); if (!planId) throw new Error("Lidarr execution job has no approved plan");
    const client = new LidarrClient({ url: value("lidarr_url", config.lidarr.url ?? ""), apiKey: value("lidarr_api_key", config.lidarr.apiKey ?? ""), rootFolder: value("lidarr_root_folder", config.lidarr.rootFolder), qualityProfileId: value("lidarr_quality_profile_id", config.lidarr.qualityProfileId), metadataProfileId: value("lidarr_metadata_profile_id", config.lidarr.metadataProfileId) });
    await executeApprovedPlan(new LidarrPlanRepository(database), client, planId);
  };
  const acquisition: JobHandler = async (job, progress, cancelled) => { const sourceName = String(job.payload?.source ?? ""); const reference = String(job.payload?.reference ?? ""); const source = sourceName === "spotify" ? spotifyProvider(config, settings).source : sourceName === "tidal" ? tidalProvider(config, settings).source : undefined; if (!source) throw new Error(`unsupported playlist source: ${sourceName}`); const playlist = await source.getPlaylist(reference); if (cancelled()) return; progress(1, 2, `Loading ${playlist.name}`); const imports = new ImportRepository(database); const imported = imports.createImport(playlist); new JobRepository(database).assignImport(job.id, imported.id); const entries = await source.getEntries(playlist); if (cancelled()) return; imports.replaceAcquiredTracks(imported.id, entries); progress(2, 2, `Imported ${playlist.name}`); };
  return { playlist_acquisition: acquisition, resolution, resolution_retry: resolution, lidarr_execution: lidarrExecution };
}
