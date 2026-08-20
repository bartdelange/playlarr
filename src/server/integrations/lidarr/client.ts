interface LidarrConfig {
  url: string;
  apiKey: string;
  timeoutMs?: number;
  rootFolder?: string;
  qualityProfileId?: number;
  metadataProfileId?: number;
}
type FetchLike = typeof fetch;

export class LidarrClient {
  constructor(
    private readonly config: LidarrConfig,
    private readonly fetcher: FetchLike = fetch,
  ) {}

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs ?? 30_000,
    );
    try {
      const response = await this.fetcher(
        `${this.config.url.replace(/\/$/, "")}/api/v1/${path}`,
        {
          method,
          headers: {
            "X-Api-Key": this.config.apiKey,
            Accept: "application/json",
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        },
      );
      if (!response.ok)
        throw new Error(`Lidarr ${method} ${path} failed: ${response.status}`);
      return response.status === 204
        ? (undefined as T)
        : ((await response.json()) as T);
    } finally {
      clearTimeout(timeout);
    }
  }

  artists() {
    return this.request<Record<string, unknown>[]>("GET", "artist");
  }
  albumsByForeignId(id: string) {
    return this.request<Record<string, unknown>[]>(
      "GET",
      `album?foreignAlbumId=${encodeURIComponent(id)}`,
    );
  }
  albumsByArtistId(id: number) {
    return this.request<Record<string, unknown>[]>(
      "GET",
      `album?artistId=${id}`,
    );
  }
  tracksByAlbumId(id: number) {
    return this.request<Record<string, unknown>[]>(
      "GET",
      `track?albumId=${id}`,
    );
  }
  tracksByArtistId(id: number) {
    return this.request<Record<string, unknown>[]>(
      "GET",
      `track?artistId=${id}`,
    );
  }
  trackFilesByArtistId(id: number) {
    return this.request<Record<string, unknown>[]>(
      "GET",
      `trackFile?artistId=${id}`,
    );
  }

  async lookup(
    path: "artist" | "album",
    foreignId: string,
    idField: string,
  ): Promise<Record<string, unknown> | undefined> {
    const matches = await this.request<Record<string, unknown>[]>(
      "GET",
      `${path}/lookup?term=${encodeURIComponent(`lidarr:${foreignId}`)}`,
    );
    return matches.find((match) => match[idField] === foreignId);
  }

  artistPayload(lookup: Record<string, unknown>) {
    return {
      ...lookup,
      qualityProfileId: this.config.qualityProfileId,
      metadataProfileId: this.config.metadataProfileId,
      rootFolderPath: this.config.rootFolder,
      monitored: false,
      monitorNewItems: "none",
      addOptions: {
        monitor: "none",
        monitored: false,
        albumsToMonitor: [],
        searchForMissingAlbums: false,
      },
    };
  }

  async createArtist(artistMbid: string): Promise<Record<string, unknown>> {
    const lookup = await this.lookup("artist", artistMbid, "foreignArtistId");
    if (!lookup)
      throw new Error(`Lidarr could not look up artist ${artistMbid}`);
    return this.request("POST", "artist", this.artistPayload(lookup));
  }

  async createAlbum(
    artist: Record<string, unknown>,
    releaseGroupId: string,
    requestedReleaseIds: string[],
  ): Promise<Record<string, unknown> | undefined> {
    const lookup = await this.lookup("album", releaseGroupId, "foreignAlbumId");
    if (!lookup)
      throw new Error(
        `Lidarr could not look up release group ${releaseGroupId}`,
      );
    const payload = {
      ...lookup,
      artistId: artist.id,
      artist,
      monitored: false,
      addOptions: { addType: "manual", searchForNewAlbum: false },
    };
    pinSelectedRelease(payload, new Set(requestedReleaseIds));
    return this.request("POST", "album", payload);
  }
}

export function isVariousArtistsAlbum(album: Record<string, unknown>): boolean {
  const artist = album.artist as Record<string, unknown> | undefined;
  return (
    artist?.foreignArtistId === "89ad4ac3-39f7-470e-963a-56509c546377" ||
    String(artist?.artistName ?? "").toLowerCase() === "various artists"
  );
}

export function pinSelectedRelease(
  album: Record<string, unknown>,
  requested: Set<string>,
): boolean {
  const releases = (album.releases ?? []) as Record<string, unknown>[];
  const candidates = releases.filter((release) =>
    requested.has(String(release.foreignReleaseId ?? "")),
  );
  if (!candidates.length) return false;
  const selected =
    candidates.find((release) => release.monitored) ?? candidates[0];
  let changed = album.anyReleaseOk !== false;
  album.anyReleaseOk = false;
  for (const release of releases) {
    const monitored = release === selected;
    changed ||= release.monitored !== monitored;
    release.monitored = monitored;
  }
  return changed;
}
