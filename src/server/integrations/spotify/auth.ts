import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
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
export interface SpotifyPendingAuthorization {
  state: string;
  verifier: string;
  redirectUri: string;
  createdAt: number;
}
export interface SpotifyPendingAuthorizationStore {
  save(pending: SpotifyPendingAuthorization): Promise<void>;
  consume(): Promise<SpotifyPendingAuthorization | undefined>;
}
export class FileSpotifyTokenStore implements SpotifyTokenStore {
  constructor(private readonly tokenPath: string) {}
  async load() {
    try {
      return normalizeTokens(JSON.parse(await readFile(this.tokenPath, "utf8")));
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
export class FileSpotifyPendingAuthorizationStore implements SpotifyPendingAuthorizationStore {
  constructor(private readonly pendingPath: string) {}

  async save(pending: SpotifyPendingAuthorization): Promise<void> {
    await mkdir(path.dirname(this.pendingPath), { recursive: true });
    const temporary = `${this.pendingPath}.tmp`;
    await writeFile(temporary, JSON.stringify(pending), { mode: 0o600 });
    await rename(temporary, this.pendingPath);
  }

  async consume(): Promise<SpotifyPendingAuthorization | undefined> {
    const claimed = `${this.pendingPath}.${randomBytes(12).toString("hex")}.consume`;
    try {
      await rename(this.pendingPath, claimed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    try {
      return JSON.parse(await readFile(claimed, "utf8")) as SpotifyPendingAuthorization;
    } finally {
      await unlink(claimed).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }
}
type FetchLike = typeof fetch;

const pendingLifetimeMs = 10 * 60 * 1000;

export class SpotifyAuthenticator {
  constructor(
    private readonly clientId: string,
    private readonly redirectUri: string,
    private readonly store: SpotifyTokenStore,
    private readonly pendingStore: SpotifyPendingAuthorizationStore,
    private readonly fetcher: FetchLike = fetch,
    private readonly now = () => Date.now(),
  ) {
    if (!clientId) throw new Error("SPOTIFY_CLIENT_ID is required for Spotify");
  }

  async authorizationUrl(): Promise<string> {
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(64).toString("base64url");
    await this.pendingStore.save({
      state,
      verifier,
      redirectUri: this.redirectUri,
      createdAt: this.now(),
    });
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
    const pending = await this.pendingStore.consume();
    if (
      !pending ||
      this.now() - pending.createdAt > pendingLifetimeMs ||
      pending.createdAt > this.now() + 30_000 ||
      !safeEqual(state, pending.state)
    )
      throw new Error("Spotify authentication state is missing or invalid; try again");
    await this.exchange({
      grant_type: "authorization_code",
      code,
      redirect_uri: pending.redirectUri,
      code_verifier: pending.verifier,
    });
  }

  async accessToken(): Promise<string> {
    const tokens = await this.store.load();
    if (!tokens) throw new Error("authenticate Spotify in Settings first");
    if (tokens.expiresAt > this.now() + 30_000) return tokens.accessToken;
    if (!tokens.refreshToken) throw new Error("Spotify session expired; authenticate again in Settings");
    return (
      await this.exchange({ grant_type: "refresh_token", refresh_token: tokens.refreshToken }, tokens.refreshToken)
    ).accessToken;
  }

  private async exchange(parameters: Record<string, string>, previousRefreshToken?: string): Promise<SpotifyTokens> {
    const body = new URLSearchParams({
      client_id: this.clientId,
      ...parameters,
    });
    const response = await this.fetcher("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) throw new Error(`Spotify token exchange failed: ${response.status}`);
    const payload = (await response.json()) as Record<string, unknown>;
    const tokens = {
      accessToken: String(payload.access_token),
      refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : previousRefreshToken,
      expiresAt: this.now() + Number(payload.expires_in ?? 3600) * 1000,
    };
    await this.store.save(tokens);
    return tokens;
  }
}

function normalizeTokens(value: unknown): SpotifyTokens {
  const tokens = value as Record<string, unknown>;
  const accessToken = tokens.accessToken ?? tokens.access_token;
  const refreshToken = tokens.refreshToken ?? tokens.refresh_token;
  const currentExpiry = tokens.expiresAt;
  const legacyExpiry = tokens.expires_at;
  const expiresAt =
    typeof currentExpiry === "number"
      ? currentExpiry
      : typeof legacyExpiry === "number"
        ? legacyExpiry * 1000
        : Number.NaN;
  if (typeof accessToken !== "string" || !Number.isFinite(expiresAt)) throw new Error("Spotify token cache is invalid");
  return {
    accessToken,
    refreshToken: typeof refreshToken === "string" ? refreshToken : undefined,
    expiresAt,
  };
}
function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
