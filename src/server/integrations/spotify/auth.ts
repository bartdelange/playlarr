import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const scope = "playlist-read-private playlist-read-collaborative";
export interface SpotifyTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}
export interface SpotifyTokenStore {
  load(): Promise<SpotifyTokens | undefined>;
  save(tokens: SpotifyTokens): Promise<void>;
}
export class FileSpotifyTokenStore implements SpotifyTokenStore {
  constructor(private readonly tokenPath: string) {}
  async load() {
    try {
      return JSON.parse(
        await readFile(this.tokenPath, "utf8"),
      ) as SpotifyTokens;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
  async save(tokens: SpotifyTokens) {
    await mkdir(path.dirname(this.tokenPath), { recursive: true });
    const temporary = `${this.tokenPath}.tmp`;
    await writeFile(temporary, JSON.stringify(tokens), { mode: 0o600 });
    await rename(temporary, this.tokenPath);
  }
}
type FetchLike = typeof fetch;

export class SpotifyAuthenticator {
  private pending?: { state: string; verifier: string };
  constructor(
    private readonly clientId: string,
    private readonly redirectUri: string,
    private readonly store: SpotifyTokenStore,
    private readonly fetcher: FetchLike = fetch,
    private readonly now = () => Date.now(),
  ) {
    if (!clientId) throw new Error("SPOTIFY_CLIENT_ID is required for Spotify");
  }

  authorizationUrl(): string {
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(64).toString("base64url");
    this.pending = { state, verifier };
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const url = new URL("https://accounts.spotify.com/authorize");
    Object.entries({
      client_id: this.clientId,
      response_type: "code",
      redirect_uri: this.redirectUri,
      scope,
      state,
      code_challenge_method: "S256",
      code_challenge: challenge,
    }).forEach(([key, value]) => url.searchParams.set(key, value));
    return url.toString();
  }

  async complete(code: string, state: string): Promise<void> {
    const pending = this.pending;
    this.pending = undefined;
    if (!pending || !safeEqual(state, pending.state))
      throw new Error(
        "Spotify authentication state is missing or invalid; try again",
      );
    await this.exchange({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.redirectUri,
      code_verifier: pending.verifier,
    });
  }

  async accessToken(): Promise<string> {
    const tokens = await this.store.load();
    if (!tokens) throw new Error("authenticate Spotify in Settings first");
    if (tokens.expiresAt > this.now() + 30_000) return tokens.accessToken;
    if (!tokens.refreshToken)
      throw new Error(
        "Spotify session expired; authenticate again in Settings",
      );
    return (
      await this.exchange(
        { grant_type: "refresh_token", refresh_token: tokens.refreshToken },
        tokens.refreshToken,
      )
    ).accessToken;
  }

  private async exchange(
    parameters: Record<string, string>,
    previousRefreshToken?: string,
  ): Promise<SpotifyTokens> {
    const body = new URLSearchParams({
      client_id: this.clientId,
      ...parameters,
    });
    const response = await this.fetcher(
      "https://accounts.spotify.com/api/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      },
    );
    if (!response.ok)
      throw new Error(`Spotify token exchange failed: ${response.status}`);
    const payload = (await response.json()) as Record<string, unknown>;
    const tokens = {
      accessToken: String(payload.access_token),
      refreshToken:
        typeof payload.refresh_token === "string"
          ? payload.refresh_token
          : previousRefreshToken,
      expiresAt: this.now() + Number(payload.expires_in ?? 3600) * 1000,
    };
    await this.store.save(tokens);
    return tokens;
  }
}
function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
