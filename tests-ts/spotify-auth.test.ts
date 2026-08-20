import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  FileSpotifyPendingAuthorizationStore,
  FileSpotifyTokenStore,
  SpotifyAuthenticator,
  type SpotifyPendingAuthorization,
  type SpotifyTokens,
} from "../src/server/integrations/spotify/auth";
const memoryStore = (initial?: SpotifyTokens) => {
  let value = initial;
  return {
    load: async () => value,
    save: async (tokens: SpotifyTokens) => {
      value = tokens;
    },
  };
};
const pendingStore = () => {
  let value: SpotifyPendingAuthorization | undefined;
  return {
    save: async (pending: SpotifyPendingAuthorization) => {
      value = pending;
    },
    consume: async () => {
      const pending = value;
      value = undefined;
      return pending;
    },
  };
};
const paths: string[] = [];
afterEach(() =>
  paths.splice(0).forEach((value) => rmSync(value, { recursive: true })),
);
it("uses PKCE and rejects a callback with the wrong state", async () => {
  const fetcher = vi.fn();
  const auth = new SpotifyAuthenticator(
    "client",
    "http://localhost/callback",
    memoryStore(),
    pendingStore(),
    fetcher,
  );
  const url = new URL(await auth.authorizationUrl());
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  await expect(auth.complete("code", "wrong")).rejects.toThrow("state");
  expect(fetcher).not.toHaveBeenCalled();
});
it("exchanges a matching callback and refreshes an expired persisted session", async () => {
  const store = memoryStore();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        access_token: "first",
        refresh_token: "refresh",
        expires_in: 0,
      }),
    )
    .mockResolvedValueOnce(
      Response.json({ access_token: "second", expires_in: 3600 }),
    );
  const auth = new SpotifyAuthenticator(
    "client",
    "http://localhost/callback",
    store,
    pendingStore(),
    fetcher,
    () => 1000,
  );
  const state = new URL(await auth.authorizationUrl()).searchParams.get(
    "state",
  )!;
  await auth.complete("code", state);
  await expect(auth.accessToken()).resolves.toBe("second");
  const refreshBody = fetcher.mock.calls[1][1].body as URLSearchParams;
  expect(refreshBody.get("grant_type")).toBe("refresh_token");
  expect(refreshBody.get("refresh_token")).toBe("refresh");
});
it.each([
  "http://127.0.0.1:8787/callback",
  "http://127.0.0.1:8765/callback",
  "https://playlarr.example.test/oauth/spotify/callback",
])(
  "passes the configured redirect URI through authorization and exchange: %s",
  async (configuredRedirectUri) => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 3600,
      }),
    );
    const auth = new SpotifyAuthenticator(
      "client",
      configuredRedirectUri,
      memoryStore(),
      pendingStore(),
      fetcher,
    );

    const authorization = new URL(await auth.authorizationUrl());
    await auth.complete("code", authorization.searchParams.get("state")!);

    expect(authorization.searchParams.get("redirect_uri")).toBe(
      configuredRedirectUri,
    );
    const exchangeBody = fetcher.mock.calls[0][1].body as URLSearchParams;
    expect(exchangeBody.get("redirect_uri")).toBe(configuredRedirectUri);
    expect(exchangeBody.get("code_verifier")).toBeTruthy();
  },
);
it("does not let a browser request origin override the configured redirect URI", async () => {
  const configuredRedirectUri = "http://127.0.0.1:8787/callback";
  const browserRequestOrigin = "https://playlarr.example.test";
  const auth = new SpotifyAuthenticator(
    "client",
    configuredRedirectUri,
    memoryStore(),
    pendingStore(),
  );

  const authorization = new URL(
    // @ts-expect-error The authorization API intentionally accepts no request origin.
    await auth.authorizationUrl(browserRequestOrigin),
  );

  expect(authorization.searchParams.get("redirect_uri")).toBe(
    configuredRedirectUri,
  );
});

it("completes a persisted PKCE authorization in a fresh runtime instance", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "playlarr-spotify-"));
  paths.push(directory);
  const pendingPath = path.join(directory, "spotify-token.json.pending");
  const tokens = memoryStore();
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      Response.json({ access_token: "access", expires_in: 3600 }),
    );
  const started = new SpotifyAuthenticator(
    "client",
    "https://playlarr.example.test/callback",
    tokens,
    new FileSpotifyPendingAuthorizationStore(pendingPath),
    fetcher,
    () => 1_000,
  );
  const authorization = new URL(await started.authorizationUrl());
  const completed = new SpotifyAuthenticator(
    "client",
    "http://changed.example.test/callback",
    tokens,
    new FileSpotifyPendingAuthorizationStore(pendingPath),
    fetcher,
    () => 2_000,
  );

  await completed.complete("code", authorization.searchParams.get("state")!);

  const body = fetcher.mock.calls[0][1].body as URLSearchParams;
  expect(body.get("redirect_uri")).toBe(
    "https://playlarr.example.test/callback",
  );
  await expect(completed.complete("code", "replay")).rejects.toThrow("state");
});

it("loads a legacy Spotipy token cache without rewriting it", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "playlarr-spotify-"));
  paths.push(directory);
  const tokenPath = path.join(directory, "spotify-token.json");
  const legacy = JSON.stringify({
    access_token: "legacy-access",
    refresh_token: "legacy-refresh",
    expires_at: 2_000_000_000,
    scope: "playlist-read-private",
    token_type: "Bearer",
  });
  writeFileSync(tokenPath, legacy, { mode: 0o600 });

  await expect(new FileSpotifyTokenStore(tokenPath).load()).resolves.toEqual({
    accessToken: "legacy-access",
    refreshToken: "legacy-refresh",
    expiresAt: 2_000_000_000_000,
  });
  expect(readFileSync(tokenPath, "utf8")).toBe(legacy);
});

it("rejects and consumes expired persisted authorization state", async () => {
  const pending = pendingStore();
  const started = new SpotifyAuthenticator(
    "client",
    "http://127.0.0.1:8787/callback",
    memoryStore(),
    pending,
    vi.fn(),
    () => 1_000,
  );
  const authorization = new URL(await started.authorizationUrl());
  const completed = new SpotifyAuthenticator(
    "client",
    "http://127.0.0.1:8787/callback",
    memoryStore(),
    pending,
    vi.fn(),
    () => 10 * 60 * 1000 + 1_001,
  );

  await expect(
    completed.complete("code", authorization.searchParams.get("state")!),
  ).rejects.toThrow("state");
  await expect(
    completed.complete("code", authorization.searchParams.get("state")!),
  ).rejects.toThrow("state");
});
