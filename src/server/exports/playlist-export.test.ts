import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import {
  appendLocalAdditions,
  buildPlaylistExport,
  translatePath,
} from "../../server/application/playlist-export";
import {
  mappingRow,
  serializeCsv,
  writeMappingReports,
} from "../../server/exports/mapping-report";
import { serializeM3u } from "../../server/exports/m3u";
const track = {
  source: "spotify",
  sourceTrackId: "one",
  title: "First",
  artists: ["Artist"],
  album: "Album",
  isrc: "US-ABC-12-34567",
};
it("preserves ordered duplicates and writes extended M3U paths", () => {
  const tracks = [
    track,
    { ...track, sourceTrackId: "missing", title: "Missing" },
    track,
  ];
  const results = tracks.map(() => ({ resolvedVia: "isrc" }));
  const exported = buildPlaylistExport(
    tracks,
    results,
    new Map([
      [0, "/music/First.flac"],
      [2, "/music/First.flac"],
    ]),
    [["/music", "/media/music"]],
  );
  expect(exported.entries.map((entry) => entry.position)).toEqual([0, 2]);
  expect(exported.missing[0].reason).toBe("not_downloaded_or_unmatched");
  const m3u = serializeM3u(exported);
  expect(m3u.match(/Artist - First/g)).toHaveLength(2);
  expect(m3u.match(/\/media\/music\/First.flac/g)).toHaveLength(2);
});
it("uses boundary-safe path translation and appends local additions", () => {
  expect(translatePath("/musical/a.flac", [["/music", "/media"]])).toBe(
    "/musical/a.flac",
  );
  const exported = appendLocalAdditions(
    { entries: [], missing: [] },
    [
      {
        provider: "navidrome",
        providerTrackId: "song",
        title: "Local",
        artists: ["Artist"],
        album: "Album",
      },
    ],
    new Map([[0, "/music/local.flac"]]),
    [["/music", "/media"]],
    4,
  );
  expect(exported.entries[0]).toMatchObject({
    position: 4,
    path: "/media/local.flac",
  });
});
it("serializes legacy-compatible mapping CSV with normalized ISRC and quoting", () => {
  const row = mappingRow(
    { source: "spotify", id: "list", name: "List" },
    { ...track, title: "Song, Live" },
    {
      resolvedVia: "isrc",
      recordingIds: ["recording"],
      releaseGroupIds: ["group"],
    },
  );
  const csv = serializeCsv([row]);
  expect(csv).toContain('"Song, Live"');
  expect(csv).toContain("USABC1234567");
  expect(csv).toContain("mb_release_group_ids");
});
it("writes complete and unresolved mapping reports", async () => {
  const directory = mkdtempSync(`${tmpdir()}/playlarr-reports-`);
  try {
    const playlist = { source: "spotify", id: "list", name: "List" };
    const rows = [
      mappingRow(playlist, track, { resolvedVia: "isrc" }),
      mappingRow(
        playlist,
        { ...track, sourceTrackId: "two" },
        { failureReason: "none" },
      ),
    ];
    const paths = await writeMappingReports(directory, playlist, rows);
    expect(readFileSync(paths.mapping, "utf8")).toContain("track_title");
    expect(readFileSync(paths.mapping, "utf8")).toContain("one");
    expect(readFileSync(paths.unresolved, "utf8")).not.toContain(",one,");
    expect(readFileSync(paths.unresolved, "utf8")).toContain("two");
  } finally {
    rmSync(directory, { recursive: true });
  }
});
