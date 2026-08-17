import type { LidarrPlan } from "../domain/lidarr";
import { isVariousArtistsAlbum, pinSelectedRelease } from "../integrations/lidarr/client";

const variousArtists = "89ad4ac3-39f7-470e-963a-56509c546377";
interface ApprovedPlanRepository { get(id: string): { status: string; plan: LidarrPlan }; recordExecution(id: string, results: ExecutionResult[]): void }
interface LidarrExecutionTransport {
  artists(): Promise<Record<string, unknown>[]>; albumsByForeignId(id: string): Promise<Record<string, unknown>[]>; tracksByAlbumId?(id: number): Promise<Record<string, unknown>[]>;
  createArtist?(mbid: string): Promise<Record<string, unknown>>; createAlbum?(artist: Record<string, unknown>, group: string, releases: string[]): Promise<Record<string, unknown> | undefined>;
  request(method: string, path: string, body?: unknown): Promise<unknown>;
}
interface ExecutionResult { outcome: string; details?: string }

export async function executeApprovedPlan(repository: ApprovedPlanRepository, client: LidarrExecutionTransport, id: string): Promise<ExecutionResult[]> {
  const current = repository.get(id);
  if (current.status !== "approved") throw new Error("plan is not approved or has been superseded");
  const artists = new Map((await client.artists()).map((artist) => [String(artist.foreignArtistId), artist]));
  const albums = new Map<string, Record<string, unknown> | undefined>(); const createdArtists = new Set<string>(); const changedReleases = new Set<string>(); const results: ExecutionResult[] = [];
  const album = async (group: string) => { if (!albums.has(group)) albums.set(group, (await client.albumsByForeignId(group)).find((item) => item.foreignAlbumId === group)); return albums.get(group); };

  for (const action of current.plan.actions) {
    try {
      if (!["create_artist", "monitor_artist", "create_release", "monitor_release", "queue_search"].includes(action.action)) { results.push({ outcome: "unchanged", details: action.reason }); continue; }
      const allowVarious = Boolean(action.payload?.allow_various_artists_release);
      if (action.artistMbid === variousArtists && !allowVarious) { results.push({ outcome: "skipped", details: "various_artists" }); continue; }
      const artistMbid = action.artistMbid ?? "";
      if (action.action === "create_artist") {
        if (artists.has(artistMbid)) results.push({ outcome: "unchanged", details: "artist_exists" });
        else { if (!client.createArtist) throw new Error("safe artist creation is unavailable"); const created = await client.createArtist(artistMbid); if (created.id === undefined) throw new Error(`Lidarr did not return created artist ${artistMbid}`); artists.set(artistMbid, created); createdArtists.add(artistMbid); results.push({ outcome: "created" }); }
        continue;
      }
      if (action.action === "monitor_artist") {
        const artist = artists.get(artistMbid); if (!artist) throw new Error(`artist is unavailable: ${artistMbid}`);
        if (artist.monitored === true && artist.monitorNewItems === "none") results.push({ outcome: "unchanged", details: "already_monitored" });
        else { artist.monitored = true; artist.monitorNewItems = "none"; await client.request("PUT", `artist/${artist.id}`, artist); results.push({ outcome: "updated" }); }
        continue;
      }
      const group = action.releaseGroupId ?? ""; const existing = await album(group);
      if (action.action === "create_release") {
        if (existing) results.push(isVariousArtistsAlbum(existing) && !allowVarious ? { outcome: "skipped", details: "various_artists_album" } : { outcome: "unchanged", details: "release_exists" });
        else { const artist = artists.get(artistMbid); if (!artist) throw new Error(`artist is unavailable: ${artistMbid}`); if (!client.createAlbum) throw new Error("safe release creation is unavailable"); const created = await client.createAlbum(artist, group, stringPayload(action.payload, "requested_release_ids")); if (!created) results.push({ outcome: "skipped", details: "various_artists_album" }); else { albums.set(group, created); changedReleases.add(group); results.push({ outcome: "created" }); } }
        continue;
      }
      if (!existing) throw new Error(`release is unavailable: ${group}`);
      if (isVariousArtistsAlbum(existing) && !allowVarious) { results.push({ outcome: "skipped", details: "various_artists_album" }); continue; }
      if (action.action === "monitor_release") {
        const releaseChanged = pinSelectedRelease(existing, new Set(stringPayload(action.payload, "requested_release_ids"))); const monitorChanged = !existing.monitored;
        if (!releaseChanged && !monitorChanged) results.push({ outcome: "unchanged", details: "already_monitored_and_release_selected" });
        else { existing.monitored = true; await client.request("PUT", `album/${existing.id}`, existing); changedReleases.add(group); results.push({ outcome: "updated" }); }
        continue;
      }
      let searchEnabled = changedReleases.has(group) || createdArtists.has(artistMbid); const requested = stringPayload(action.payload, "requested_recording_ids");
      if (!searchEnabled && requested.length) { const tracks = client.tracksByAlbumId ? await client.tracksByAlbumId(Number(existing.id)) : await client.request("GET", `track?albumId=${existing.id}`) as Record<string, unknown>[]; searchEnabled = !tracks.some((track) => track.hasFile && requested.includes(String(track.foreignRecordingId))); }
      if (!searchEnabled) results.push({ outcome: "unchanged", details: "search_precondition_already_satisfied" });
      else { await client.request("POST", "command", { name: "AlbumSearch", albumIds: [existing.id] }); results.push({ outcome: "queued" }); }
    } catch (error) { results.push({ outcome: "failed", details: error instanceof Error ? error.message : String(error) }); }
  }
  repository.recordExecution(id, results); return results;
}

function stringPayload(payload: Record<string, unknown> | undefined, key: string): string[] { const value = payload?.[key]; return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
