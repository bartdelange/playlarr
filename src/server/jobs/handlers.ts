import type Database from "better-sqlite3";
import { executeApprovedPlan } from "../application/lidarr-execution";
import {
  appendLocalAdditions,
  buildPlaylistExport,
} from "../application/playlist-export";
import { planLidarr } from "../application/lidarr-planning";
import type { AppConfig } from "../config/environment";
import { LidarrClient } from "../integrations/lidarr/client";
import { spotifyProvider, tidalProvider } from "../integrations/sources";
import { MusicBrainzClient } from "../integrations/musicbrainz/client";
import { MusicBrainzResolver } from "../integrations/musicbrainz/orchestrator";
import { NavidromeClient } from "../integrations/navidrome/client";
import { ImportRepository } from "../persistence/import-repository";
import { LibraryRepository } from "../persistence/library-repository";
import { LocalAdditionsRepository } from "../persistence/local-additions-repository";
import { JobRepository } from "../persistence/job-repository";
import { LidarrPlanRepository } from "../persistence/lidarr-plan-repository";
import { ResolutionRepository } from "../persistence/resolution-repository";
import type { SettingsRepository } from "../persistence/settings-repository";
import type { JobHandler } from "./worker";
import { playlistOutputPath, writeM3u } from "../exports/m3u";
import { mappingRow, writeMappingReports } from "../exports/mapping-report";
import type { AcquiredTrack, PlaylistInfo } from "../domain/playlist";
import { playlistSnapshotToken } from "../domain/playlist-snapshot";
import { previewPlaylistUpdate } from "../domain/playlist-updates";
import { refreshLibraryStatus } from "../application/library-status";
import { normalizeMusicBrainzResult } from "../domain/musicbrainz";

export function productionJobHandlers(
  database: Database.Database,
  config: AppConfig,
  settings: SettingsRepository,
): Record<string, JobHandler> {
  const value = <T>(key: string, fallback: T) => settings.get(key, fallback);
  const resolution: JobHandler = async (job, progress, cancelled) => {
    if (!job.importId) throw new Error("resolution job has no import");
    const imports = new ImportRepository(database);
    const allEntries = imports.entries(job.importId);
    const retryEntryId =
      job.kind === "resolution_retry"
        ? Number(job.payload?.entryId)
        : undefined;
    const entries = retryEntryId
      ? allEntries.filter((entry) => entry.id === retryEntryId)
      : allEntries;
    if (retryEntryId && entries.length !== 1)
      throw new Error("retry entry does not belong to this import");
    let unresolved = false;
    const resolver = new MusicBrainzResolver(
      new MusicBrainzClient({
        baseUrl: config.musicBrainz.baseUrl,
        userAgent: value("mb_user_agent", config.musicBrainz.userAgent),
        requestDelayMs: config.musicBrainz.requestDelay * 1000,
        timeoutMs: config.musicBrainz.timeout * 1000,
        maxRetries: config.musicBrainz.maxRetries,
      }),
    );
    const resolutions = new ResolutionRepository(database);
    for (const [index, entry] of entries.entries()) {
      if (cancelled()) return;
      if (entry.resolutionState === "skipped" || entry.isManual) {
        progress(index + 1, entries.length, entry.track.title);
        continue;
      }
      resolutions.markResolving(entry.id);
      const result = await resolver.resolve(entry.track);
      unresolved ||= !result.resolvedVia;
      resolutions.saveAutomatic(entry.id, result);
      progress(index + 1, entries.length, entry.track.title);
    }
    const requiresReview =
      job.kind === "resolution_retry"
        ? imports
            .entries(job.importId)
            .some((entry) =>
              [
                "pending",
                "resolving",
                "unresolved",
                "ambiguous",
                "validation_failed",
              ].includes(entry.resolutionState),
            )
        : unresolved;
    imports.setWorkflowState(
      job.importId,
      requiresReview ? "review_required" : "ready_to_plan",
    );
    const imported = imports.getImport(job.importId);
    const playlist = {
      source: imported.source,
      id: imported.sourcePlaylistId,
      name: imported.playlistName,
      path: imported.playlistPath,
    };
    const rows = imports
      .entries(job.importId)
      .map((entry) =>
        mappingRow(playlist, entry.track, resolutions.get(entry.id).result),
      );
    await writeMappingReports(config.outputDir, playlist, rows);
  };
  const lidarrExecution: JobHandler = async (job) => {
    const planId = String(job.payload?.planId ?? "");
    if (!planId) throw new Error("Lidarr execution job has no approved plan");
    const client = new LidarrClient({
      url: value("lidarr_url", config.lidarr.url ?? ""),
      apiKey: value("lidarr_api_key", config.lidarr.apiKey ?? ""),
      rootFolder: value("lidarr_root_folder", config.lidarr.rootFolder),
      qualityProfileId: value(
        "lidarr_quality_profile_id",
        config.lidarr.qualityProfileId,
      ),
      metadataProfileId: value(
        "lidarr_metadata_profile_id",
        config.lidarr.metadataProfileId,
      ),
    });
    await executeApprovedPlan(
      new LidarrPlanRepository(database),
      client,
      planId,
    );
  };
  const lidarrPlanning: JobHandler = async (job, progress) => {
    if (!job.importId) throw new Error("Lidarr planning job has no import");
    const rows = database
      .prepare(
        "SELECT r.result_json, r.evidence_json, r.selected_release_group_id FROM resolutions r JOIN playlist_entries e ON e.id = r.entry_id WHERE e.import_id = ? ORDER BY e.position",
      )
      .all(job.importId) as {
      result_json: string;
      evidence_json: string;
      selected_release_group_id: string | null;
    }[];
    const results = rows.map((row) => {
      const result = JSON.parse(
        row.result_json,
      ) as import("../domain/musicbrainz").MusicBrainzResult;
      return row.selected_release_group_id
        ? { ...result, releaseGroupIds: [row.selected_release_group_id] }
        : result;
    });
    const client = new LidarrClient({
      url: value("lidarr_url", config.lidarr.url ?? ""),
      apiKey: value("lidarr_api_key", config.lidarr.apiKey ?? ""),
      rootFolder: value("lidarr_root_folder", config.lidarr.rootFolder),
      qualityProfileId: value(
        "lidarr_quality_profile_id",
        config.lidarr.qualityProfileId,
      ),
      metadataProfileId: value(
        "lidarr_metadata_profile_id",
        config.lidarr.metadataProfileId,
      ),
    });
    progress(0, 3, "Comparing downloaded Lidarr files");
    const library = new LibraryRepository(database);
    const statuses = await refreshLibraryStatus(results, client);
    library.saveStatus(job.importId, statuses);
    const representedLocally = new Set(
      statuses
        .filter(
          (status) =>
            status.path || status.classification === "represented_locally",
        )
        .map((status) => status.position),
    );
    progress(1, 3, "Loading Lidarr artists");
    const artists = new Set(
      (await client.artists()).map((artist) => String(artist.foreignArtistId)),
    );
    const groups = new Set<string>();
    for (const group of new Set(
      results.flatMap((result) => result.releaseGroupIds ?? []),
    ))
      if (
        (await client.albumsByForeignId(group)).some(
          (album) => album.foreignAlbumId === group,
        )
      )
        groups.add(group);
    progress(2, 3, "Building read-only plan");
    const allowed = new Set(
      rows.flatMap((row, index) =>
        (JSON.parse(row.evidence_json) as Record<string, unknown>)
          .allow_various_artists_release
          ? (results[index].recordingIds ?? [])
          : [],
      ),
    );
    new LidarrPlanRepository(database).save(
      job.importId,
      planLidarr(results, artists, groups, allowed, representedLocally),
    );
    progress(3, 3, "Plan ready for approval");
  };
  const acquisition: JobHandler = async (job, progress, cancelled) => {
    const sourceName = String(job.payload?.source ?? "");
    const reference = String(job.payload?.reference ?? "");
    const source =
      sourceName === "spotify"
        ? spotifyProvider(config, settings).source
        : sourceName === "tidal"
          ? tidalProvider(config, settings).source
          : undefined;
    if (!source) throw new Error(`unsupported playlist source: ${sourceName}`);
    const playlist = await source.getPlaylist(reference);
    if (cancelled()) return;
    progress(1, 2, `Loading ${playlist.name}`);
    const imports = new ImportRepository(database);
    const imported = imports.createImport(playlist);
    new JobRepository(database).assignImport(job.id, imported.id);
    const entries = await source.getEntries(playlist);
    if (cancelled()) return;
    imports.replaceAcquiredTracks(imported.id, entries);
    progress(2, 2, `Imported ${playlist.name}`);
  };
  const catalogue: JobHandler = async (job, progress, cancelled) => {
    const sourceName = String(job.payload?.source ?? "");
    const source =
      sourceName === "spotify"
        ? spotifyProvider(config, settings).source
        : sourceName === "tidal"
          ? tidalProvider(config, settings).source
          : undefined;
    if (!source) throw new Error(`unsupported playlist source: ${sourceName}`);

    progress(0, 0, `Loading ${sourceName} playlists`);
    const playlists = await source.listPlaylists();
    if (cancelled()) return;
    new JobRepository(database).setPayload(job.id, {
      source: sourceName,
      playlists,
    });
    progress(
      playlists.length,
      playlists.length,
      `Loaded ${playlists.length} playlists`,
    );
  };
  const updatePreview: JobHandler = async (job, progress, cancelled) => {
    if (!job.importId) throw new Error("playlist update preview has no import");
    const imported = new ImportRepository(database).getImport(job.importId);
    const source =
      imported.source === "spotify"
        ? spotifyProvider(config, settings).source
        : imported.source === "tidal"
          ? tidalProvider(config, settings).source
          : undefined;
    if (!source)
      throw new Error(`unsupported playlist source: ${imported.source}`);
    progress(0, 2, "Fetching the current source playlist");
    const playlist = await source.getPlaylist(imported.sourcePlaylistId);
    const entries = await source.getEntries(playlist);
    if (cancelled()) return;
    new JobRepository(database).setPayload(job.id, {
      playlist,
      entries,
      snapshotToken: playlistSnapshotToken(entries),
    });
    progress(2, 2, "Playlist update preview ready");
  };
  const updatePlaylist: JobHandler = async (job, progress) => {
    if (!job.importId) throw new Error("playlist update has no import");
    const previewId = String(job.payload?.previewJob ?? "");
    const approvedToken = String(job.payload?.snapshotToken ?? "");
    const preview = new JobRepository(database).get(previewId);
    if (
      preview.importId !== job.importId ||
      preview.kind !== "playlist_update_preview" ||
      preview.status !== "completed" ||
      !preview.payload
    )
      throw new Error("playlist update preview is not ready");
    const playlist = preview.payload.playlist as PlaylistInfo;
    const entries = preview.payload.entries as AcquiredTrack[];
    const currentToken = playlistSnapshotToken(entries);
    if (
      !approvedToken ||
      approvedToken !== currentToken ||
      preview.payload.snapshotToken !== currentToken
    )
      throw new Error("the source playlist changed; preview the update again");
    progress(1, 2, "Applying the approved playlist update");
    const imports = new ImportRepository(database);
    const update = previewPlaylistUpdate(
      imports.entries(job.importId),
      entries,
    );
    if (update.added || update.removed || update.updated || update.moved)
      imports.applyPlaylistUpdate(job.importId, playlist, entries);
    new JobRepository(database).setPayload(job.id, {
      previewJob: previewId,
      snapshotToken: currentToken,
      update,
    });
    progress(2, 2, "Playlist update complete");
  };
  const generation: JobHandler = async (job, progress) => {
    if (!job.importId) throw new Error("playlist generation job has no import");
    const imports = new ImportRepository(database);
    const imported = imports.getImport(job.importId);
    if (
      !["library_status", "playlist_generated"].includes(imported.workflowState)
    )
      throw new Error("refresh download status before generating a playlist");
    const entries = imports.entries(job.importId);
    const rows = database
      .prepare(
        "SELECT e.position, r.result_json, l.file_path FROM playlist_entries e JOIN resolutions r ON r.entry_id = e.id LEFT JOIN library_status l ON l.entry_id = e.id WHERE e.import_id = ? ORDER BY e.position",
      )
      .all(job.importId) as {
      position: number;
      result_json: string;
      file_path: string | null;
    }[];
    const mappings = value<[string, string][]>("path_mappings", [
      ["/music", "/music"],
    ]);
    progress(0, 2, "Building ordered playlist");
    let exported = buildPlaylistExport(
      entries.map((entry) => entry.track),
      rows.map((row) =>
        normalizeMusicBrainzResult(JSON.parse(row.result_json)),
      ),
      new Map(
        rows
          .filter((row) => row.file_path)
          .map((row) => [row.position, row.file_path!]),
      ),
      mappings,
    );
    const additions = new LocalAdditionsRepository(database).list(job.importId);
    if (additions.length) {
      const navidrome = new NavidromeClient({
        url: value("navidrome_url", config.navidrome.url ?? ""),
        username: value("navidrome_username", config.navidrome.username ?? ""),
        password: value("navidrome_password", config.navidrome.password ?? ""),
      });
      exported = appendLocalAdditions(
        exported,
        additions,
        await navidrome.paths(
          additions.map((addition) => addition.providerTrackId),
        ),
        mappings,
        entries.length,
      );
    }
    const output = playlistOutputPath(config.outputDir, imported.playlistName);
    await writeM3u(output, exported);
    new LibraryRepository(database).recordExport(
      job.importId,
      output,
      exported.entries.length,
      exported.missing.length,
    );
    progress(2, 2, `Wrote ${output}`);
  };
  const libraryStatus: JobHandler = async (job, progress) => {
    if (!job.importId) throw new Error("library status job has no import");
    const imported = new ImportRepository(database).getImport(job.importId);
    if (
      ![
        "waiting_for_downloads",
        "library_status",
        "playlist_generated",
      ].includes(imported.workflowState)
    )
      throw new Error("apply a Lidarr plan before refreshing downloads");
    const results = (
      database
        .prepare(
          "SELECT r.result_json FROM resolutions r JOIN playlist_entries e ON e.id = r.entry_id WHERE e.import_id = ? ORDER BY e.position",
        )
        .all(job.importId) as { result_json: string }[]
    ).map((row) => normalizeMusicBrainzResult(JSON.parse(row.result_json)));
    if (!results.some((result) => result.resolvedVia))
      throw new Error("there are no resolved tracks to check");
    const client = new LidarrClient({
      url: value("lidarr_url", config.lidarr.url ?? ""),
      apiKey: value("lidarr_api_key", config.lidarr.apiKey ?? ""),
    });
    new LibraryRepository(database).saveStatus(
      job.importId,
      await refreshLibraryStatus(results, client, progress),
    );
  };
  return {
    playlist_catalogue: catalogue,
    playlist_acquisition: acquisition,
    playlist_update_preview: updatePreview,
    playlist_update: updatePlaylist,
    resolution,
    resolution_retry: resolution,
    lidarr_planning: lidarrPlanning,
    lidarr_execution: lidarrExecution,
    library_status: libraryStatus,
    playlist_generation: generation,
  };
}
