import type { LidarrPlan, LidarrPlanAction } from "../domain/lidarr";
import type { MusicBrainzResult } from "../domain/musicbrainz";
import { isVariousArtistsAlbum, pinSelectedRelease } from "../integrations/lidarr/client";

const variousArtistsMbid = "89ad4ac3-39f7-470e-963a-56509c546377";
const versionQualifier =
  /\s*[\[(][^\])]*\b(?:edit|mix|remix|version|rework|remaster(?:ed)?|radio|extended|live)\b[^\])]*[\])]\s*$/i;

export interface LidarrPlanningClient {
  artists(): Promise<Record<string, unknown>[]>;
  albumsByArtistId(id: number): Promise<Record<string, unknown>[]>;
  albumsByForeignId(id: string): Promise<Record<string, unknown>[]>;
  tracksByArtistId(id: number): Promise<Record<string, unknown>[]>;
  tracksByAlbumId(id: number): Promise<Record<string, unknown>[]>;
  lookup(path: "artist" | "album", foreignId: string, idField: string): Promise<Record<string, unknown> | undefined>;
}

export async function planLidarr(
  results: MusicBrainzResult[],
  client: LidarrPlanningClient,
  allowedVariousArtistsRecordings = new Set<string>(),
  progress?: (current: number, total: number, item: string) => void,
): Promise<LidarrPlan> {
  const actions: LidarrPlanAction[] = [];
  const overrideGroups = new Set(
    results.flatMap((result) =>
      (result.recordingIds ?? []).some((id) => allowedVariousArtistsRecordings.has(id))
        ? (result.releaseGroupIds ?? [])
        : [],
    ),
  );
  const requestedReleaseIds = new Map<string, Set<string>>();
  for (const result of results)
    for (const group of result.releaseGroupIds ?? []) appendValues(requestedReleaseIds, group, result.releaseIds ?? []);

  const actionPayload = (group: string, values: Record<string, unknown> = {}) => {
    const payload = { ...values };
    const releases = [...(requestedReleaseIds.get(group) ?? [])].sort();
    if (releases.length) payload.requested_release_ids = releases;
    if (overrideGroups.has(group)) payload.allow_various_artists_release = true;
    return Object.keys(payload).length ? payload : undefined;
  };

  const grouped = new Map<string, MusicBrainzResult[]>();
  for (const result of results) {
    const artist = result.primaryArtistId;
    if (!artist) {
      actions.push({ action: "skip", reason: "musicbrainz_unresolved" });
      continue;
    }
    if (!result.releaseGroupIds?.length) {
      actions.push({
        action: "skip",
        artistMbid: artist,
        artistName: result.artistNames?.[0] ?? "",
        reason: "release_group_unresolved",
      });
      continue;
    }
    if (
      artist === variousArtistsMbid ||
      result.artistNames?.some((name) => name.toLocaleLowerCase() === "various artists")
    ) {
      actions.push({
        action: "skip",
        artistMbid: artist,
        artistName: "Various Artists",
        reason: "various_artists_skipped",
      });
      continue;
    }
    grouped.set(artist, [...(grouped.get(artist) ?? []), result]);
  }

  const total = grouped.size + 1;
  progress?.(0, total, "Loading artists from Lidarr");
  const existingArtists = new Map((await client.artists()).map((artist) => [text(artist.foreignArtistId), artist]));
  progress?.(1, total, "Loaded Lidarr artists");
  const globalAlbums = new Map<string, Record<string, unknown> | undefined>();
  const tracksByAlbum = new Map<number, Record<string, unknown>[]>();

  const globalAlbum = async (group: string) => {
    if (!globalAlbums.has(group)) {
      const album = (await client.albumsByForeignId(group)).find((candidate) => candidate.foreignAlbumId === group);
      globalAlbums.set(group, album);
    }
    return globalAlbums.get(group);
  };

  let artistNumber = 0;
  for (const [artistMbid, artistResults] of grouped) {
    artistNumber += 1;
    const artist = existingArtists.get(artistMbid);
    let artistName = artistResults.flatMap((result) => result.artistNames ?? [])[0] ?? artistMbid;
    progress?.(artistNumber, total, `Inspecting ${artistName}`);
    const requestedGroups = new Set(artistResults.flatMap((result) => result.releaseGroupIds ?? []));

    if (!artist) {
      actions.push({
        action: "create_artist",
        artistMbid,
        artistName,
        reason: "artist_missing",
        payload: { release_group_ids: [...requestedGroups].sort() },
      });
      for (const group of [...requestedGroups].sort()) {
        const existingAlbum = await globalAlbum(group);
        const lookup = existingAlbum ?? (await client.lookup("album", group, "foreignAlbumId"));
        if (lookup && isVariousArtistsAlbum(lookup) && !overrideGroups.has(group)) {
          actions.push(releaseAction("skip", artistMbid, artistName, group, lookup, "various_artists_album"));
          continue;
        }
        if (existingAlbum)
          actions.push(
            releaseAction(
              "reuse_existing_release",
              artistMbid,
              artistName,
              group,
              existingAlbum,
              "release_exists_globally",
            ),
          );
        else
          actions.push(
            releaseAction(
              "create_release",
              artistMbid,
              artistName,
              group,
              lookup,
              "release_missing",
              actionPayload(group),
            ),
          );
        const releaseNeedsPinning = Boolean(
          existingAlbum &&
          requestedReleaseIds.get(group)?.size &&
          pinSelectedRelease(cloneAlbum(existingAlbum), requestedReleaseIds.get(group)!),
        );
        if (!existingAlbum || !existingAlbum.monitored || releaseNeedsPinning)
          actions.push(
            releaseAction(
              "monitor_release",
              artistMbid,
              artistName,
              group,
              lookup,
              "requested_release",
              actionPayload(group),
            ),
          );
        actions.push(
          releaseAction(
            "queue_search",
            artistMbid,
            artistName,
            group,
            lookup,
            "requested_track_missing",
            actionPayload(group),
          ),
        );
      }
      actions.push({
        action: "monitor_artist",
        artistMbid,
        artistName,
        reason: "monitored_with_new_items_disabled",
      });
      continue;
    }

    artistName = text(artist.artistName) || artistName;
    const artistId = number(artist.id);
    const tracks = await client.tracksByArtistId(artistId);
    const albums = await client.albumsByArtistId(artistId);
    const albumsByGroup = new Map(
      albums.filter((album) => text(album.foreignAlbumId)).map((album) => [text(album.foreignAlbumId), album]),
    );
    const albumsById = new Map(
      albums.filter((album) => album.id !== undefined).map((album) => [number(album.id), album]),
    );
    const downloadedKeys = downloadedTrackKeys(tracks);
    const effectiveGroups = new Set<string>();
    const groupsNeedingSearch = new Set<string>();
    const missingRecordings = new Map<string, Set<string>>();

    for (const result of artistResults) {
      let match = downloadedAlbumMatch(result, tracks, albumsById);
      if (!match.group)
        for (const group of result.releaseGroupIds ?? []) {
          if (albumsByGroup.has(group)) continue;
          const album = await globalAlbum(group);
          if (!album || (isVariousArtistsAlbum(album) && !overrideGroups.has(group))) continue;
          const albumId = number(album.id);
          if (!tracksByAlbum.has(albumId)) tracksByAlbum.set(albumId, await client.tracksByAlbumId(albumId));
          const candidate = downloadedAlbumMatch(result, tracksByAlbum.get(albumId)!, new Map([[albumId, album]]));
          if (candidate.group) {
            match = candidate;
            break;
          }
        }

      if (match.group) {
        effectiveGroups.add(match.group);
        const album = albumsByGroup.get(match.group) ?? globalAlbums.get(match.group);
        const payload = {
          lidarr_album_id: album?.id,
          requested_recording_ids: result.recordingIds ?? [],
          matched_track: matchedTrackPayload(match.track!, match.method),
        };
        if (!result.releaseGroupIds?.includes(match.group))
          actions.push(
            releaseAction(
              "reuse_downloaded_release",
              artistMbid,
              artistName,
              match.group,
              albumsByGroup.get(match.group),
              "downloaded_recording_match",
              {
                ...payload,
                mapped_release_group_ids: result.releaseGroupIds ?? [],
              },
            ),
          );
        else
          actions.push(
            releaseAction(
              "unchanged",
              artistMbid,
              artistName,
              match.group,
              album,
              "requested_recording_downloaded",
              payload,
            ),
          );
      } else {
        for (const group of result.releaseGroupIds ?? []) effectiveGroups.add(group);
        if (!representedByDownload(result, downloadedKeys))
          for (const group of result.releaseGroupIds ?? []) {
            groupsNeedingSearch.add(group);
            appendValues(missingRecordings, group, result.recordingIds ?? []);
          }
      }
    }

    for (const album of albums) globalAlbums.set(text(album.foreignAlbumId), album);
    for (const group of [...effectiveGroups].sort()) {
      let album = albumsByGroup.get(group) ?? globalAlbums.get(group);
      if (!album) album = await globalAlbum(group);
      if (album && isVariousArtistsAlbum(album) && !overrideGroups.has(group)) {
        actions.push(releaseAction("skip", artistMbid, artistName, group, album, "various_artists_album"));
        continue;
      }
      if (!album) {
        const lookup = await client.lookup("album", group, "foreignAlbumId");
        if (lookup && isVariousArtistsAlbum(lookup) && !overrideGroups.has(group)) {
          actions.push(releaseAction("skip", artistMbid, artistName, group, lookup, "various_artists_album"));
          continue;
        }
        actions.push(
          releaseAction(
            "create_release",
            artistMbid,
            artistName,
            group,
            lookup,
            "release_missing",
            actionPayload(group),
          ),
        );
        album = lookup;
      }
      if (groupsNeedingSearch.has(group)) {
        const recordings = [...(missingRecordings.get(group) ?? [])].sort();
        const releaseNeedsPinning = Boolean(
          album &&
          requestedReleaseIds.get(group)?.size &&
          pinSelectedRelease(cloneAlbum(album), requestedReleaseIds.get(group)!),
        );
        if (!album || !album.monitored || releaseNeedsPinning)
          actions.push(
            releaseAction(
              "monitor_release",
              artistMbid,
              artistName,
              group,
              album,
              "requested_track_missing",
              actionPayload(group, { requested_recording_ids: recordings }),
            ),
          );
        else actions.push(releaseAction("unchanged", artistMbid, artistName, group, album, "already_monitored"));
        actions.push(
          releaseAction(
            "queue_search",
            artistMbid,
            artistName,
            group,
            album,
            "requested_track_missing",
            actionPayload(group, { requested_recording_ids: recordings }),
          ),
        );
      } else if (!actions.some((action) => action.artistMbid === artistMbid && action.releaseGroupId === group))
        actions.push(
          releaseAction("unchanged", artistMbid, artistName, group, album, "requested_recording_downloaded"),
        );
    }

    const needsAcquisition = actions.some(
      (action) =>
        action.artistMbid === artistMbid &&
        ["create_release", "monitor_release", "queue_search"].includes(action.action),
    );
    if (needsAcquisition && (!artist.monitored || artist.monitorNewItems !== "none"))
      actions.push({
        action: "monitor_artist",
        artistMbid,
        artistName,
        reason: "monitored_with_new_items_disabled",
      });
    if (!actions.some((action) => action.artistMbid === artistMbid && action.action !== "unchanged"))
      actions.push({
        action: "unchanged",
        artistMbid,
        artistName,
        reason: "already_reconciled",
      });
  }

  progress?.(total, total, "Lidarr plan ready");
  return { actions };
}

function releaseAction(
  action: string,
  artistMbid: string,
  artistName: string,
  releaseGroupId: string,
  album: Record<string, unknown> | undefined,
  reason: string,
  payload?: Record<string, unknown>,
): LidarrPlanAction {
  return {
    action,
    artistMbid,
    artistName,
    releaseGroupId,
    albumTitle: text(album?.title),
    reason,
    payload,
  };
}

function downloadedTrackKeys(tracks: Record<string, unknown>[]) {
  const downloaded = tracks.filter((track) => track.hasFile);
  return {
    recordingIds: new Set(
      downloaded.flatMap((track) => [text(track.foreignRecordingId), text(track.foreignTrackId)].filter(Boolean)),
    ),
    titles: downloaded.map((track) => text(track.title)),
  };
}

function representedByDownload(result: MusicBrainzResult, keys: ReturnType<typeof downloadedTrackKeys>) {
  return (
    (result.recordingIds ?? []).some((id) => keys.recordingIds.has(id)) ||
    Boolean(result.recordingTitle && keys.titles.some((title) => titleFallbackMatches(result.recordingTitle!, title)))
  );
}

function downloadedAlbumMatch(
  result: MusicBrainzResult,
  tracks: Record<string, unknown>[],
  albumsById: Map<number, Record<string, unknown>>,
) {
  const downloaded = tracks.filter((track) => track.hasFile);
  let track = downloaded.find((candidate) =>
    [text(candidate.foreignRecordingId), text(candidate.foreignTrackId)].some(
      (id) => id && result.recordingIds?.includes(id),
    ),
  );
  let method = "recording_id";
  if (!track && result.recordingTitle) {
    track = downloaded.find((candidate) => titleFallbackMatches(result.recordingTitle!, text(candidate.title)));
    method = "normalized_title";
  }
  const album = track ? albumsById.get(number(track.albumId)) : undefined;
  return {
    group: album ? text(album.foreignAlbumId) : undefined,
    track,
    method,
  };
}

export function titleFallbackMatches(requested: string, downloaded: string) {
  const comparableRequested = normalizedTitle(requested.replace(versionQualifier, ""));
  const comparableDownloaded = normalizedTitle(downloaded.replace(versionQualifier, ""));
  if (!requested || comparableRequested !== comparableDownloaded) return false;
  return (
    !versionQualifier.test(requested) ||
    !versionQualifier.test(downloaded) ||
    normalizedTitle(requested) === normalizedTitle(downloaded)
  );
}

function normalizedTitle(value: string) {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function matchedTrackPayload(track: Record<string, unknown>, matchMethod: string) {
  return {
    id: track.id,
    title: text(track.title),
    track_number: track.trackNumber ?? track.absoluteTrackNumber,
    foreign_recording_id: text(track.foreignRecordingId) || text(track.foreignTrackId),
    track_file_id: track.trackFileId,
    has_file: Boolean(track.hasFile),
    match_method: matchMethod,
  };
}

function appendValues(target: Map<string, Set<string>>, key: string, values: string[]) {
  const existing = target.get(key) ?? new Set<string>();
  for (const value of values) existing.add(value);
  target.set(key, existing);
}

function cloneAlbum(album: Record<string, unknown>) {
  return {
    ...album,
    releases: ((album.releases ?? []) as Record<string, unknown>[]).map((release) => ({ ...release })),
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function number(value: unknown): number {
  return Number(value);
}
