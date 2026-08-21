export interface MusicBrainzTransportConfig {
  baseUrl: string;
  userAgent: string;
  requestDelayMs: number;
  timeoutMs: number;
  maxRetries: number;
}
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export class MusicBrainzClient {
  private lastRequestAt = 0;
  constructor(
    private readonly config: MusicBrainzTransportConfig,
    private readonly fetcher: FetchLike = fetch,
    private readonly sleep: (milliseconds: number) => Promise<void> = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {}
  async get(path: string, parameters: Record<string, string>): Promise<Record<string, unknown>> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        await this.waitForRateLimit();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
        try {
          const url = new URL(`${this.config.baseUrl.replace(/\/$/, "")}/${path}`);
          Object.entries(parameters).forEach(([key, value]) => url.searchParams.set(key, value));
          const response = await this.fetcher(url.toString(), {
            headers: {
              Accept: "application/json",
              "User-Agent": this.config.userAgent,
            },
            signal: controller.signal,
          });
          if (response.ok) return (await response.json()) as Record<string, unknown>;
          if (response.status >= 400 && response.status < 500 && response.status !== 429)
            throw new Error(`MusicBrainz request failed: ${response.status}`);
          lastError = new Error(`MusicBrainz request failed: ${response.status}`);
        } finally {
          clearTimeout(timeout);
        }
      } catch (error) {
        if (error instanceof Error) lastError = error;
      }
      if (attempt < this.config.maxRetries) await this.sleep((attempt + 1) * 250);
    }
    throw lastError ?? new Error("MusicBrainz request failed");
  }
  private async waitForRateLimit(): Promise<void> {
    const wait = Math.max(0, this.config.requestDelayMs - (Date.now() - this.lastRequestAt));
    if (wait) await this.sleep(wait);
    this.lastRequestAt = Date.now();
  }
}
