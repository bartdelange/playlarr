"use client";

import Link from "next/link";
import { useState } from "react";
import type { PlaylistInfo } from "../../server/domain/playlist";

export function PlaylistCatalogue({
  playlists,
  existingImports,
  csrf,
  acquisitionAction,
}: {
  playlists: PlaylistInfo[];
  existingImports: Record<string, string>;
  csrf: string;
  acquisitionAction: (form: FormData) => void | Promise<void>;
}) {
  const [filter, setFilter] = useState("");
  const visible = playlists.filter((playlist) =>
    playlist.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
  );

  return (
    <section>
      <h2>
        {playlists[0]?.source === "tidal" ? "TIDAL" : "Spotify"} playlists
      </h2>
      <label className="playlist-filter">
        <span className="sr-only">Filter playlists</span>
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter playlists…"
        />
      </label>
      <div className="playlist-catalogue">
        {visible.map((playlist) => (
          <article className="playlist-catalogue-row" key={playlist.id}>
            <div>
              <strong>{playlist.name}</strong>
              <small>
                {playlist.path || playlist.owner || ""}
                {(playlist.path || playlist.owner) && " · "}
                {playlist.trackCount ?? "?"} tracks
              </small>
            </div>
            <div className="playlist-buttons">
              {existingImports[playlist.id] ? (
                <Link
                  className="button"
                  href={`/imports/${existingImports[playlist.id]}`}
                >
                  Open import
                </Link>
              ) : (
                <form action={acquisitionAction}>
                  <input type="hidden" name="csrf_token" value={csrf} />
                  <input type="hidden" name="source" value={playlist.source} />
                  <input type="hidden" name="reference" value={playlist.id} />
                  <button>Import</button>
                </form>
              )}
            </div>
          </article>
        ))}
        {!visible.length && (
          <p className="empty-state">No playlists match this filter.</p>
        )}
      </div>
    </section>
  );
}
