import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { TidalAuthenticator } from "../src/server/integrations/tidal/auth";
import {
  FileTidalSessionStore,
  type TidalPendingAuthorization,
  type TidalSession,
  type TidalSessionStore,
} from "../src/server/integrations/tidal/session";
import { TidalSource } from "../src/server/integrations/tidal/source";
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true })),
  );
});
const memoryStore = (
  initial?: TidalSession,
): TidalSessionStore & {
  value?: TidalSession;
  pending?: TidalPendingAuthorization;
} => ({
  value: initial,
  async load() {
    return this.value;
  },
  async save(value) {
    this.value = value;
  },
  async loadPending() {
    return this.pending;
  },
  async savePending(value) {
    this.pending = value;
  },
  async clearPending() {
    this.pending = undefined;
  },
});
it("atomically persists a private session", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "playlarr-tidal-"));
  directories.push(directory);
  const file = path.join(directory, "session.json");
  const store = new FileTidalSessionStore(file);
  await store.save({ accessToken: "a", refreshToken: "r", expiresAt: 1 });
  expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({
    accessToken: "a",
  });
  expect((await stat(file)).mode & 0o777).toBe(0o600);

  await store.savePending({
    deviceCode: "device",
    intervalMs: 2_000,
    nextPollAt: 1_000,
    expiresAt: 301_000,
    status: "pending",
  });
  await expect(store.loadPending()).resolves.toMatchObject({
    deviceCode: "device",
    status: "pending",
  });
  expect((await stat(`${file}.pending`)).mode & 0o777).toBe(0o600);
  await store.clearPending();
  await expect(store.loadPending()).resolves.toBeUndefined();
});
it("restores the session file written by the master tidalapi implementation", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "playlarr-tidal-"));
  directories.push(directory);
  const file = path.join(directory, "session.json");
  await writeFile(
    file,
    JSON.stringify({
      token_type: { data: "Bearer" },
      access_token: { data: "legacy-access" },
      refresh_token: { data: "legacy-refresh" },
      is_pkce: { data: false },
    }),
  );

  await expect(new FileTidalSessionStore(file).load()).resolves.toEqual({
    accessToken: "legacy-access",
    refreshToken: "legacy-refresh",
    tokenType: "Bearer",
    expiresAt: 0,
  });
});
it("runs device authorization, polls at the supplied interval, and persists tokens", async () => {
  const store = memoryStore();
  let now = 1_000;
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        deviceCode: "device-code",
        userCode: "USER-CODE",
        verificationUri: "link.tidal.com",
        verificationUriComplete: "link.tidal.com/USER-CODE",
        expiresIn: 300,
        interval: 2,
      }),
    )
    .mockResolvedValueOnce(
      Response.json({ error: "authorization_pending" }, { status: 400 }),
    )
    .mockResolvedValueOnce(
      Response.json({
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 3600,
        token_type: "Bearer",
      }),
    )
    .mockResolvedValueOnce(
      Response.json({ sessionId: "session", userId: 1, countryCode: "NL" }),
    );
  const auth = new TidalAuthenticator(
    store,
    fetcher,
    () => now,
    "https://device.test",
    "https://token.test",
  );
  await expect(auth.beginDeviceAuthorization()).resolves.toEqual({
    verificationUrl: "https://link.tidal.com/USER-CODE",
    userCode: "USER-CODE",
    expiresIn: 300,
  });
  const poller = new TidalAuthenticator(
    store,
    fetcher,
    () => now,
    "https://device.test",
    "https://token.test",
  );
  await expect(poller.authorizationStatus()).resolves.toEqual({
    status: "pending",
  });
  await expect(poller.authorizationStatus()).resolves.toEqual({
    status: "pending",
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  now += 2_000;
  await expect(poller.authorizationStatus()).resolves.toEqual({
    status: "completed",
  });
  expect(store.value).toMatchObject({
    accessToken: "access",
    refreshToken: "refresh",
    tokenType: "Bearer",
  });
  expect(store.pending).toBeUndefined();
  const deviceBody = fetcher.mock.calls[0][1].body as URLSearchParams;
  expect(deviceBody.get("scope")).toBe("r_usr w_usr w_sub");
  const tokenBody = fetcher.mock.calls[2][1].body as URLSearchParams;
  expect(tokenBody.get("grant_type")).toBe(
    "urn:ietf:params:oauth:grant-type:device_code",
  );
  expect(tokenBody.get("device_code")).toBe("device-code");
  expect(fetcher.mock.calls[3][1].headers).toEqual({
    Authorization: "Bearer access",
  });
});
it("reports denied device authorization without persisting credentials", async () => {
  const store = memoryStore();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        deviceCode: "device",
        userCode: "code",
        verificationUriComplete: "https://link.tidal.com/code",
        expiresIn: 300,
        interval: 1,
      }),
    )
    .mockResolvedValueOnce(
      Response.json({ error: "access_denied" }, { status: 400 }),
    );
  const auth = new TidalAuthenticator(
    store,
    fetcher,
    () => 1_000,
    "https://device.test",
    "https://token.test",
  );
  await auth.beginDeviceAuthorization();
  await expect(auth.authorizationStatus()).resolves.toEqual({
    status: "failed",
    error: "TIDAL device authorization was denied",
  });
  expect(store.value).toBeUndefined();
});
it("refreshes once and preserves ordered duplicate playlist tracks", async () => {
  const store = memoryStore({
    accessToken: "old",
    refreshToken: "refresh",
    expiresAt: Date.now() + 60_000,
  });
  const tokenFetch = vi
    .fn()
    .mockResolvedValue(
      Response.json({ access_token: "new", expires_in: 3600 }),
    );
  const auth = new TidalAuthenticator(store, tokenFetch);
  let calls = 0;
  const api = vi.fn(async (input: string | URL | Request) => {
    calls++;
    if (calls === 1) return new Response("", { status: 401 });
    const offset = new URL(String(input)).searchParams.get("offset");
    return Response.json({
      data: [
        {
          id: "same",
          attributes: {
            title: "Song",
            artists: [{ name: "Artist" }],
            album: { title: "Album" },
            isrc: "ISRC",
            duration: 2,
          },
        },
      ],
      links: offset === "0" ? { next: "yes" } : {},
      meta: { total: 2 },
    });
  });
  const source = new TidalSource(auth, api, "https://api.test");
  const tracks = await source.getTracks({
    source: "tidal",
    id: "playlist",
    name: "List",
  });
  expect(tracks.map((track) => track.sourceTrackId)).toEqual(["same", "same"]);
  expect(tracks[0].durationMs).toBe(2000);
  expect(store.value?.accessToken).toBe("new");
});
it("attaches verified folder paths and omits unavailable relationship items", async () => {
  const store = memoryStore({
    accessToken: "token",
    expiresAt: Date.now() + 60_000,
  });
  const auth = new TidalAuthenticator(store);
  const api = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        data: [{ id: "one", attributes: { name: "Mix", numberOfItems: 1 } }],
        links: {},
        meta: { total: 1 },
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        data: [
          { id: "missing", attributes: {} },
          { id: "track", attributes: { title: "Song" } },
        ],
        links: {},
        meta: { total: 2 },
      }),
    );
  const source = new TidalSource(auth, api, "https://api.test", {
    playlistPaths: async () => new Map([["one", "Folder/Subfolder"]]),
  });
  expect((await source.listPlaylists())[0].path).toBe("Folder/Subfolder");
  expect(
    (await source.getTracks({ source: "tidal", id: "one", name: "Mix" })).map(
      (track) => track.sourceTrackId,
    ),
  ).toEqual(["track"]);
});
