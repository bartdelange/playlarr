import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  TidalAuthenticator,
  TidalAuthenticationError,
} from "../src/server/integrations/tidal/auth";
import {
  FileTidalSessionStore,
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
): TidalSessionStore & { value?: TidalSession } => ({
  value: initial,
  async load() {
    return this.value;
  },
  async save(value) {
    this.value = value;
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
});
it("uses PKCE, validates callback state, and refreshes expired sessions", async () => {
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
  const auth = new TidalAuthenticator(
    "client",
    "http://localhost/callback",
    ["playlists.read"],
    store,
    fetcher,
    "https://login.test",
    "https://token.test",
    () => 1000,
  );
  const url = new URL(auth.authorizationUrl());
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  await auth.complete("code", url.searchParams.get("state")!);
  await expect(auth.session()).resolves.toMatchObject({
    accessToken: "second",
    refreshToken: "refresh",
  });
});
it("rejects a mismatched callback without exchanging credentials", async () => {
  const fetcher = vi.fn();
  const auth = new TidalAuthenticator(
    "client",
    "callback",
    [],
    memoryStore(),
    fetcher,
  );
  auth.authorizationUrl();
  await expect(auth.complete("code", "wrong")).rejects.toBeInstanceOf(
    TidalAuthenticationError,
  );
  expect(fetcher).not.toHaveBeenCalled();
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
  const auth = new TidalAuthenticator(
    "client",
    "callback",
    [],
    store,
    tokenFetch,
  );
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
  const auth = new TidalAuthenticator("client", "callback", [], store);
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
