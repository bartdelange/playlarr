import { rmSync } from "node:fs";

import { openDatabase } from "../src/server/persistence/database";
import { ImportRepository } from "../src/server/persistence/import-repository";
import { JobRepository } from "../src/server/persistence/job-repository";
import { LidarrPlanRepository } from "../src/server/persistence/lidarr-plan-repository";
import { PlaylistRevisionRepository } from "../src/server/persistence/playlist-revision-repository";
import { ResolutionRepository } from "../src/server/persistence/resolution-repository";
import { playlistSnapshotToken } from "../src/server/domain/playlist-snapshot";

const fixtureImportId = "00000000-0000-4000-8000-000000000001";

export default function setup() {
  rmSync("/private/tmp/playlarr-e2e", { recursive: true, force: true });
  const database = openDatabase("/private/tmp/playlarr-e2e/data/music-importer.db");
  const imports = new ImportRepository(database);
  const imported = imports.createImport(
    { source: "spotify", id: "fixture-list", name: "Fixture Playlist" },
    {},
    fixtureImportId,
  );
  imports.replaceTracks(imported.id, [
    {
      source: "spotify",
      sourceTrackId: "track-1",
      title: "Fixture Song",
      artists: ["Fixture Artist"],
      album: "Fixture Album",
      isrc: "USABC1234567",
    },
  ]);
  const entry = imports.entries(imported.id)[0];
  new ResolutionRepository(database).saveAutomatic(entry.id, {
    resolvedVia: "isrc",
    recordingTitle: "Fixture Song",
    artistNames: ["Fixture Artist"],
    recordingIds: ["recording"],
    releaseGroupIds: ["group"],
    primaryArtistId: "artist",
  });
  imports.setWorkflowState(imported.id, "ready_to_plan");
  new LidarrPlanRepository(database).save(imported.id, {
    actions: [
      {
        action: "create_release",
        artistMbid: "artist",
        artistName: "Fixture Artist",
        releaseGroupId: "group",
        albumTitle: "Fixture Album",
        reason: "release_missing",
      },
    ],
  });
  imports.setWorkflowState(imported.id, "library_status");
  new PlaylistRevisionRepository(database).record(imported.id, imports.entries(imported.id), [
    {
      position: 0,
      track: {
        source: "spotify",
        sourceTrackId: "track-1",
        title: "Fixture Song",
        artists: ["Fixture Artist"],
        album: "Fixture Album",
      },
    },
  ]);
  const jobs = new JobRepository(database);
  const job = jobs.create("resolution", imported.id, 1);
  jobs.update(job.id, { status: "completed", current: 1, currentItem: "Fixture Song" });
  const previewEntries = [
    {
      position: 0,
      track: {
        source: "spotify",
        sourceTrackId: "track-1",
        title: "Fixture Song (updated)",
        artists: ["Fixture Artist"],
        album: "Fixture Album",
      },
    },
  ];
  const preview = jobs.create("playlist_update_preview", imported.id, 2);
  jobs.setPayload(preview.id, {
    playlist: { source: "spotify", id: "fixture-list", name: "Fixture Playlist" },
    entries: previewEntries,
    snapshotToken: playlistSnapshotToken(previewEntries),
  });
  jobs.update(preview.id, { status: "completed", current: 2, currentItem: "Playlist update preview ready" });
  database.close();
}
