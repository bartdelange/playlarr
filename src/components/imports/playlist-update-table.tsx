"use client";

import { useMemo, useState } from "react";
import type { PlaylistUpdate } from "../../server/domain/playlist-updates";

export function PlaylistUpdateTable({ update }: { update: PlaylistUpdate }) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState("all");
  const visible = useMemo(
    () =>
      update.changes.filter((change) => {
        const track = change.newTrack ?? change.oldTrack;
        const search = track
          ? [track.title, ...track.artists, track.album, track.isrc].filter(Boolean).join(" ").toLocaleLowerCase()
          : "";
        return (state === "all" || change.state === state) && search.includes(query.toLocaleLowerCase());
      }),
    [query, state, update.changes],
  );

  return (
    <>
      <div className="mapping-filters">
        <input
          aria-label="Filter playlist changes"
          placeholder="Filter by title, artist, album, or ISRC…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select aria-label="Filter by change state" value={state} onChange={(event) => setState(event.target.value)}>
          <option value="all">All changes</option>
          <option value="added">Added</option>
          <option value="updated">Updated</option>
          <option value="removed">Removed</option>
          <option value="moved">Moved</option>
          <option value="unchanged">No change</option>
        </select>
        <span className="muted">{visible.length} tracks</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>State</th>
              <th>Position</th>
              <th>Track</th>
              <th>Album / ISRC</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((change, index) => {
              const track = change.newTrack ?? change.oldTrack;
              return (
                <tr key={`${change.state}-${index}`}>
                  <td>
                    <span className="badge">{change.state === "unchanged" ? "no change" : change.state}</span>
                  </td>
                  <td>{position(change.oldPosition, change.newPosition)}</td>
                  <td>
                    <strong>
                      {change.state === "updated" && change.oldTrack?.title !== change.newTrack?.title ? (
                        <>
                          <del>{change.oldTrack?.title}</del>
                          <br />
                          {change.newTrack?.title}
                        </>
                      ) : (
                        track?.title
                      )}
                    </strong>
                    <small>{track?.artists.join(", ")}</small>
                  </td>
                  <td>
                    {track?.album}
                    <small>{track?.isrc ?? "No ISRC"}</small>
                  </td>
                  <td>{change.changedFields.join(", ") || (change.state === "moved" ? "position changed" : "—")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function position(oldPosition?: number, newPosition?: number): string {
  if (oldPosition !== undefined && newPosition !== undefined && oldPosition !== newPosition)
    return `${oldPosition + 1} → ${newPosition + 1}`;
  const value = newPosition ?? oldPosition;
  return value === undefined ? "—" : String(value + 1);
}
