import type { AcquiredTrack, PlaylistInfo, SourceTrack } from "../../domain/playlist";
import { TidalAuthenticationError, type TidalAuthenticator } from "./auth";

type FetchLike = typeof fetch;
export class TidalApiError extends Error {}
export interface TidalFolderReader {
  playlistPaths(): Promise<Map<string, string>>;
}
export class TidalSource {
  readonly name = "tidal";
  constructor(
    private readonly auth: TidalAuthenticator,
    private readonly fetcher: FetchLike = fetch,
    private readonly baseUrl = "https://openapi.tidal.com/v2",
    private readonly folders?: TidalFolderReader,
  ) {}
  static playlistId(value: string): string {
    return /(?:playlist\/|playlist:)([0-9a-f-]+)/i.exec(value)?.[1] ?? value.trim().split("?", 1)[0].replace(/\/$/, "");
  }
  async listPlaylists(): Promise<PlaylistInfo[]> {
    const paths = (await this.folders?.playlistPaths().catch(() => new Map<string, string>())) ?? new Map();
    return (await this.all("playlists")).map((item) => {
      const attributes = record(item.attributes);
      const id = String(item.id);
      return {
        source: this.name,
        id,
        name: String(attributes.name ?? item.name ?? "Untitled"),
        path: paths.get(id),
        trackCount: numberValue(attributes.numberOfItems ?? item.numTracks),
      };
    });
  }
  async getPlaylist(value: string): Promise<PlaylistInfo> {
    const id = TidalSource.playlistId(value);
    const response = await this.request(`playlists/${encodeURIComponent(id)}`);
    const item = record(response.data ?? response);
    const attributes = record(item.attributes);
    return {
      source: this.name,
      id,
      name: String(attributes.name ?? item.name ?? "Untitled"),
      trackCount: numberValue(attributes.numberOfItems ?? item.numTracks),
    };
  }
  async getTracks(playlist: PlaylistInfo): Promise<SourceTrack[]> {
    const items = await this.all(`playlists/${encodeURIComponent(playlist.id)}/relationships/items`);
    return items.flatMap((item) => this.track(item) ?? []);
  }
  async getEntries(playlist: PlaylistInfo): Promise<AcquiredTrack[]> {
    return (await this.getTracks(playlist)).map((track, position) => ({
      position,
      track,
    }));
  }
  private track(item: Record<string, unknown>): SourceTrack | undefined {
    const attributes = record(item.attributes ?? item);
    const id = item.id ?? attributes.id;
    const title = attributes.title ?? attributes.name;
    if (id === undefined || !title) return undefined;
    const artists = Array.isArray(attributes.artists)
      ? attributes.artists
          .map((artist) => (typeof artist === "string" ? artist : String(record(artist).name ?? "")))
          .filter(Boolean)
      : [];
    const album = record(attributes.album);
    const duration =
      numberValue(attributes.durationMs) ??
      (numberValue(attributes.duration) === undefined
        ? undefined
        : Math.round(numberValue(attributes.duration)! * 1000));
    return {
      source: this.name,
      sourceTrackId: String(id),
      title: String(title),
      artists,
      album: String(album.title ?? album.name ?? ""),
      isrc: typeof attributes.isrc === "string" ? attributes.isrc : undefined,
      durationMs: duration,
    };
  }
  private async all(path: string): Promise<Record<string, unknown>[]> {
    const result: Record<string, unknown>[] = [];
    let offset = 0;
    while (true) {
      const page = await this.request(`${path}?${new URLSearchParams({ limit: "100", offset: String(offset) })}`);
      const data = Array.isArray(page.data) ? page.data : Array.isArray(page.items) ? page.items : [];
      result.push(...data.map(record));
      const links = record(page.links);
      const meta = record(page.meta);
      if (!links.next || result.length >= Number(meta.total ?? result.length)) return result;
      offset += 100;
    }
  }
  private async request(path: string, retried = false): Promise<Record<string, unknown>> {
    const session = await this.auth.session();
    const response = await this.fetcher(`${this.baseUrl.replace(/\/$/, "")}/${path}`, {
      headers: {
        Accept: "application/vnd.tidal.v1+json",
        Authorization: `Bearer ${session.accessToken}`,
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 401 && !retried) {
      await this.auth.refresh(session);
      return this.request(path, true);
    }
    if (response.status === 401 || response.status === 403)
      throw new TidalAuthenticationError(`TIDAL authentication failed (${response.status})`);
    if (!response.ok) throw new TidalApiError(`TIDAL request failed (${response.status})`);
    return response.json() as Promise<Record<string, unknown>>;
  }
}
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const numberValue = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
