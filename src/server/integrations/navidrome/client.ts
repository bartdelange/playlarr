import { createHash, randomBytes } from "node:crypto";

export interface NavidromeSong {
  id: string;
  title: string;
  artist: string;
  album: string;
  path: string;
}
interface NavidromeConfig {
  url: string;
  username: string;
  password: string;
  timeoutMs?: number;
}
type FetchLike = typeof fetch;

export class NavidromeClient {
  constructor(
    private readonly config: NavidromeConfig,
    private readonly fetcher: FetchLike = fetch,
    private readonly saltFactory = () => randomBytes(8).toString("hex"),
  ) {
    if (!config.url || !config.username || !config.password)
      throw new Error("Navidrome is not configured");
  }

  async searchSongs(query: string, limit = 50): Promise<NavidromeSong[]> {
    const payload = await this.request("search3", {
      query,
      songCount: String(limit),
      albumCount: "0",
      artistCount: "0",
    });
    const result = payload.searchResult3 as Record<string, unknown> | undefined;
    return (Array.isArray(result?.song) ? result.song : []).map((song) =>
      this.songFrom(song as Record<string, unknown>),
    );
  }

  async song(id: string): Promise<NavidromeSong> {
    const payload = await this.request("getSong", { id });
    return this.songFrom(payload.song as Record<string, unknown>);
  }

  async paths(songIds: string[]): Promise<Map<number, string>> {
    const paths = new Map<number, string>();
    for (const [index, id] of songIds.entries()) {
      try {
        const song = await this.song(id);
        if (song.path) paths.set(index, song.path);
      } catch {
        /* Missing local additions are intentionally omitted from exports. */
      }
    }
    return paths;
  }

  private async request(
    method: string,
    parameters: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const salt = this.saltFactory();
    const token = createHash("md5")
      .update(`${this.config.password}${salt}`)
      .digest("hex");
    const url = new URL(
      `${this.config.url.replace(/\/$/, "")}/rest/${method}.view`,
    );
    Object.entries({
      u: this.config.username,
      t: token,
      s: salt,
      v: "1.16.1",
      c: "playlarr",
      f: "json",
      ...parameters,
    }).forEach(([key, value]) => url.searchParams.set(key, value));
    const response = await this.fetcher(url, {
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 30_000),
    });
    if (!response.ok)
      throw new Error(`Navidrome ${method} failed: ${response.status}`);
    const wrapper = ((await response.json()) as Record<string, unknown>)[
      "subsonic-response"
    ] as Record<string, unknown> | undefined;
    if (wrapper?.status !== "ok") {
      const error = wrapper?.error as Record<string, unknown> | undefined;
      throw new Error(String(error?.message ?? "Navidrome request failed"));
    }
    return wrapper;
  }

  private songFrom(song: Record<string, unknown>): NavidromeSong {
    return {
      id: String(song.id),
      title: String(song.title ?? ""),
      artist: String(song.artist ?? ""),
      album: String(song.album ?? ""),
      path: String(song.path ?? ""),
    };
  }
}
