import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { TidalSession, TidalSessionStore } from "./session";

type FetchLike = typeof fetch;
export class TidalAuthenticationError extends Error {}
export class TidalAuthenticator {
  private pending?: { state: string; verifier: string };
  constructor(
    private readonly clientId: string,
    private readonly redirectUri: string,
    private readonly scopes: string[],
    private readonly store: TidalSessionStore,
    private readonly fetcher: FetchLike = fetch,
    private readonly authorizationBase = "https://login.tidal.com/authorize",
    private readonly tokenUrl = "https://auth.tidal.com/v1/oauth2/token",
    private readonly now = () => Date.now(),
  ) {}
  authorizationUrl(): string {
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(64).toString("base64url");
    this.pending = { state, verifier };
    const url = new URL(this.authorizationBase);
    Object.entries({
      response_type: "code",
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: this.scopes.join(" "),
      state,
      code_challenge_method: "S256",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    }).forEach(([key, value]) => url.searchParams.set(key, value));
    return url.toString();
  }
  async complete(code: string, state: string): Promise<void> {
    const pending = this.pending;
    this.pending = undefined;
    if (!pending || !safeEqual(state, pending.state))
      throw new TidalAuthenticationError(
        "TIDAL authentication state is missing or invalid; try again",
      );
    await this.exchange({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.redirectUri,
      code_verifier: pending.verifier,
    });
  }
  async session(): Promise<TidalSession> {
    const current = await this.store.load();
    if (!current)
      throw new TidalAuthenticationError(
        "authenticate TIDAL in Settings first",
      );
    if (current.expiresAt > this.now() + 30_000) return current;
    return this.refresh(current);
  }
  async refresh(current?: TidalSession): Promise<TidalSession> {
    const session = current ?? (await this.store.load());
    if (!session?.refreshToken)
      throw new TidalAuthenticationError(
        "TIDAL refresh token is missing; authenticate again in Settings",
      );
    return this.exchange(
      { grant_type: "refresh_token", refresh_token: session.refreshToken },
      session.refreshToken,
    );
  }
  private async exchange(
    parameters: Record<string, string>,
    oldRefresh?: string,
  ): Promise<TidalSession> {
    const response = await this.fetcher(this.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.clientId, ...parameters }),
    });
    if (!response.ok)
      throw new TidalAuthenticationError(
        `TIDAL token exchange failed (${response.status})`,
      );
    const token = (await response.json()) as Record<string, unknown>;
    const session = {
      accessToken: String(token.access_token),
      refreshToken:
        typeof token.refresh_token === "string"
          ? token.refresh_token
          : oldRefresh,
      expiresAt: this.now() + Number(token.expires_in ?? 3600) * 1000,
      tokenType:
        typeof token.token_type === "string" ? token.token_type : undefined,
      scope: typeof token.scope === "string" ? token.scope : undefined,
    };
    await this.store.save(session);
    return session;
  }
}
function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
