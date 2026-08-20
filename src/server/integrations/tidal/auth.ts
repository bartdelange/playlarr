import type {
  TidalPendingAuthorization,
  TidalSession,
  TidalSessionStore,
} from "./session";

type FetchLike = typeof fetch;
type AuthorizationStatus =
  | { status: "missing" | "pending" | "completed" }
  | { status: "failed"; error: string };

export interface TidalDeviceAuthorization {
  verificationUrl: string;
  userCode: string;
  expiresIn: number;
}

const scope = "r_usr w_usr w_sub";
const deviceGrant = "urn:ietf:params:oauth:grant-type:device_code";
const deviceAuthorizationUrl =
  "https://auth.tidal.com/v1/oauth2/device_authorization";
const tokenUrl = "https://auth.tidal.com/v1/oauth2/token";
const sessionUrl = "https://api.tidal.com/v1/sessions";

export class TidalAuthenticationError extends Error {}

export class TidalAuthenticator {
  private pending?: TidalPendingAuthorization;
  private readonly clientId = tidalapiCredential([
    "WmxneVNuaGtiVzUw",
    "V2xkTE1HbDRWQT09",
  ]);
  private readonly clientSecret = tidalapiCredential([
    "TVU1dU9VRm1SRUZxZUhKblNrWktZa3RPVjB4bFFY",
    "bExSMVpIYlVsT2RWaFFVRXhJVmxoQmRuaEJaejA9",
  ]);

  constructor(
    private readonly store: TidalSessionStore,
    private readonly fetcher: FetchLike = fetch,
    private readonly now = () => Date.now(),
    private readonly deviceUrl = deviceAuthorizationUrl,
    private readonly oauthTokenUrl = tokenUrl,
    private readonly tidalSessionUrl = sessionUrl,
  ) {}

  async beginDeviceAuthorization(): Promise<TidalDeviceAuthorization> {
    const response = await this.post(this.deviceUrl, {
      client_id: this.clientId,
      scope,
    });
    if (!response.ok)
      throw new TidalAuthenticationError(
        `TIDAL device authorization failed (${response.status})`,
      );
    const payload = await json(response);
    const deviceCode = text(payload.deviceCode);
    const userCode = text(payload.userCode);
    const verification = text(
      payload.verificationUriComplete ?? payload.verificationUri,
    );
    const expiresIn = positiveNumber(payload.expiresIn, 300);
    const intervalMs = positiveNumber(payload.interval, 2) * 1000;
    if (!deviceCode || !userCode || !verification)
      throw new TidalAuthenticationError(
        "TIDAL returned an incomplete device authorization",
      );

    this.pending = {
      deviceCode,
      intervalMs,
      nextPollAt: this.now(),
      expiresAt: this.now() + expiresIn * 1000,
      status: "pending",
    };
    await this.store.savePending(this.pending);
    return {
      verificationUrl: /^https?:\/\//i.test(verification)
        ? verification
        : `https://${verification}`,
      userCode,
      expiresIn,
    };
  }

  async authorizationStatus(): Promise<AuthorizationStatus> {
    const pending = this.pending ?? (await this.store.loadPending());
    if (!pending) return { status: "missing" };
    this.pending = pending;
    if (pending.status === "failed")
      return {
        status: "failed",
        error: pending.error ?? "Authentication failed",
      };
    if (this.now() >= pending.expiresAt)
      return await this.fail(
        pending,
        "TIDAL device authorization expired; try again",
      );
    if (this.now() < pending.nextPollAt) return { status: "pending" };

    pending.nextPollAt = this.now() + pending.intervalMs;
    await this.store.savePending(pending);
    const response = await this.post(this.oauthTokenUrl, {
      client_id: this.clientId,
      client_secret: this.clientSecret,
      device_code: pending.deviceCode,
      grant_type: deviceGrant,
      scope,
    });
    const payload = await json(response);
    if (!response.ok) {
      const error = text(payload.error);
      if (error === "authorization_pending") return { status: "pending" };
      if (error === "slow_down") {
        pending.intervalMs += 5000;
        await this.store.savePending(pending);
        return { status: "pending" };
      }
      return await this.fail(
        pending,
        error === "expired_token"
          ? "TIDAL device authorization expired; try again"
          : error === "access_denied"
            ? "TIDAL device authorization was denied"
            : `TIDAL device authorization failed${error ? `: ${error}` : ""}`,
      );
    }

    await this.saveToken(payload, undefined, true);
    this.pending = undefined;
    await this.store.clearPending();
    return { status: "completed" };
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
    const response = await this.post(this.oauthTokenUrl, {
      grant_type: "refresh_token",
      refresh_token: session.refreshToken,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });
    if (!response.ok)
      throw new TidalAuthenticationError(
        `TIDAL token refresh failed (${response.status}); authenticate again in Settings`,
      );
    return this.saveToken(await json(response), session.refreshToken);
  }

  private async saveToken(
    payload: Record<string, unknown>,
    oldRefresh?: string,
    verify = false,
  ): Promise<TidalSession> {
    const accessToken = text(payload.access_token);
    if (!accessToken)
      throw new TidalAuthenticationError("TIDAL returned no access token");
    const session = {
      accessToken,
      refreshToken: text(payload.refresh_token) || oldRefresh,
      expiresAt: this.now() + positiveNumber(payload.expires_in, 3600) * 1000,
      tokenType: text(payload.token_type),
      scope: text(payload.scope),
    };
    if (verify) await this.verifySession(accessToken);
    await this.store.save(session);
    return session;
  }

  private async verifySession(accessToken: string): Promise<void> {
    const response = await this.fetcher(this.tidalSessionUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok)
      throw new TidalAuthenticationError(
        `TIDAL session verification failed (${response.status})`,
      );
  }

  private post(url: string, values: Record<string, string>) {
    return this.fetcher(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(values),
      signal: AbortSignal.timeout(30_000),
    });
  }

  private async fail(
    pending: TidalPendingAuthorization,
    error: string,
  ): Promise<{ status: "failed"; error: string }> {
    pending.status = "failed";
    pending.error = error;
    await this.store.savePending(pending);
    return { status: "failed", error };
  }
}

function tidalapiCredential(parts: string[]): string {
  const inner = parts
    .map((part) => Buffer.from(part, "base64").toString())
    .join("");
  return Buffer.from(inner, "base64").toString();
}

async function json(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function positiveNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
