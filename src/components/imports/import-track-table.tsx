"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type TrackRow = {
  id: number;
  position: number;
  state: string;
  title: string;
  artists: string[];
  album: string;
  method?: string;
  matchedTitle?: string;
  matchedArtists?: string[];
  libraryClassification?: string;
  libraryPath?: string;
};

const reviewStates = new Set(["unresolved", "ambiguous", "validation_failed"]);
const downloadedStates = new Set([
  "represented_locally",
  "release_downloaded",
  "recording_match",
]);

export function ImportTrackTable({
  rows,
  stage = "match",
}: {
  rows: TrackRow[];
  stage?: "match" | "final";
}) {
  const [filter, setFilter] = useState("all");
  const [columns, setColumns] = useState({ state: true });
  const visibleRows = useMemo(
    () =>
      rows.filter((row) => {
        if (filter === "downloaded")
          return downloadedStates.has(row.libraryClassification ?? "");
        if (filter === "downloadable")
          return row.libraryClassification === "release_monitored_missing";
        if (filter === "not_downloadable")
          return (
            !downloadedStates.has(row.libraryClassification ?? "") &&
            row.libraryClassification !== "release_monitored_missing"
          );
        if (filter === "review") return reviewStates.has(row.state);
        if (filter === "automatic")
          return row.state === "automatically_resolved";
        if (filter === "manual") return row.state === "manually_resolved";
        return true;
      }),
    [filter, rows],
  );

  const filters =
    stage === "final"
      ? [
          ["all", `All (${rows.length})`],
          [
            "downloaded",
            `Downloaded (${rows.filter((row) => downloadedStates.has(row.libraryClassification ?? "")).length})`,
          ],
          [
            "downloadable",
            `Missing but downloadable (${rows.filter((row) => row.libraryClassification === "release_monitored_missing").length})`,
          ],
          [
            "not_downloadable",
            `Not downloadable (${rows.filter((row) => !downloadedStates.has(row.libraryClassification ?? "") && row.libraryClassification !== "release_monitored_missing").length})`,
          ],
        ]
      : [
          ["all", `All (${rows.length})`],
          ["review", "Needs review"],
          ["automatic", "Automatic"],
          ["manual", "Manual"],
        ];

  return (
    <>
      <div className="filters" aria-label="Track filters">
        {filters.map(([value, label]) => (
          <button
            className={filter === value ? "active" : "secondary"}
            key={value}
            onClick={() => setFilter(value)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      <details className="column-picker">
        <summary>Choose visible columns</summary>
        <div className="column-options">
          {Object.entries(columns).map(([column, checked]) => (
            <label key={column}>
              <input
                checked={checked}
                onChange={(event) =>
                  setColumns((current) => ({
                    ...current,
                    [column]: event.target.checked,
                  }))
                }
                type="checkbox"
              />
              {column[0].toUpperCase() + column.slice(1)}
            </label>
          ))}
        </div>
      </details>
      {visibleRows.length === 0 && (
        <p className="empty-filter">No tracks in this filter.</p>
      )}
      <div className="table-wrap import-table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              {columns.state && <th>Status</th>}
              <th>Source track</th>
              {stage === "match" ? (
                <>
                  <th>Matched recording</th>
                  <th>Method</th>
                </>
              ) : (
                <>
                  <th>Lidarr matched</th>
                  <th>Library state</th>
                </>
              )}
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.id}>
                <td>{row.position + 1}</td>
                {columns.state && (
                  <td>
                    <span className="badge">
                      {row.state.replaceAll("_", " ")}
                    </span>
                  </td>
                )}
                <td>
                  <strong>{row.title}</strong>
                  <small>
                    {row.artists.join(", ")}
                    {row.album && ` · ${row.album}`}
                  </small>
                </td>
                {stage === "match" ? (
                  <>
                    <td>
                      <strong>{row.matchedTitle || "Not matched"}</strong>
                      <small>{row.matchedArtists?.join(", ")}</small>
                    </td>
                    <td>{row.method ?? "—"}</td>
                  </>
                ) : (
                  <>
                    <td>
                      {row.libraryPath ? (
                        <div className="matched-lidarr-track">
                          <span className="eyebrow">Matched Lidarr track</span>
                          <strong>{row.matchedTitle || row.title}</strong>
                          <small>{row.matchedArtists?.join(", ")}</small>
                        </div>
                      ) : (
                        <span className="muted">No matched Lidarr track</span>
                      )}
                    </td>
                    <td>
                      <LibraryState
                        classification={row.libraryClassification}
                        path={row.libraryPath}
                      />
                    </td>
                  </>
                )}
                <td>
                  <Link href={`/entries/${row.id}/review`}>Review</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function LibraryState({
  classification,
  path,
}: {
  classification?: string;
  path?: string;
}) {
  if (!classification)
    return <span className="status attention">Not refreshed</span>;
  if (downloadedStates.has(classification))
    return (
      <>
        <span className="status ok">Downloaded</span>
        {path && <small>{path}</small>}
      </>
    );
  if (classification === "release_monitored_missing")
    return (
      <>
        <span className="status attention">Missing but downloadable</span>
        <small>
          Release exists and is monitored, but this recording has not downloaded
          yet.
        </small>
      </>
    );
  return (
    <>
      <span className="status attention">Not downloadable</span>
      <small>{classification.replaceAll("_", " ")}</small>
    </>
  );
}
