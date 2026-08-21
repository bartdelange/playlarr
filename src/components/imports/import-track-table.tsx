"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
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
const downloadedStates = new Set(["represented_locally", "release_downloaded", "recording_match"]);

export function ImportTrackTable({ rows, stage = "match" }: { rows: TrackRow[]; stage?: "match" | "final" }) {
  const params = useParams<{ id?: string }>();
  const [filter, setFilter] = useState("all");
  const columnLabels =
    stage === "match"
      ? ["#", "Status", "Source track", "Matched recording", "Method", "Actions"]
      : ["#", "Status", "Source track", "Lidarr matched", "Library state", "Actions"];
  const [columns, setColumns] = useState(() => columnLabels.map(() => true));
  const visibleRows = useMemo(
    () =>
      rows.filter((row) => {
        if (filter === "downloaded") return downloadedStates.has(row.libraryClassification ?? "");
        if (filter === "downloadable") return row.libraryClassification === "release_monitored_missing";
        if (filter === "not_downloadable")
          return (
            !downloadedStates.has(row.libraryClassification ?? "") &&
            row.libraryClassification !== "release_monitored_missing"
          );
        if (filter === "review") return reviewStates.has(row.state);
        if (filter === "automatic") return row.state === "automatically_resolved";
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
  const reviewCount = rows.filter((row) => reviewStates.has(row.state)).length;

  return (
    <>
      {stage === "match" && params.id && reviewCount > 0 && (
        <div className="actions">
          <Link className="button secondary" href={`/imports/${params.id}/review`}>
            Review {reviewCount} tracks
          </Link>
        </div>
      )}
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
          {columnLabels.map((label, index) => (
            <label key={label}>
              <input
                checked={columns[index]}
                onChange={(event) =>
                  setColumns((current) =>
                    current.map((value, currentIndex) => (currentIndex === index ? event.target.checked : value)),
                  )
                }
                type="checkbox"
              />
              {label}
            </label>
          ))}
        </div>
      </details>
      {visibleRows.length === 0 && <p className="empty-filter">No tracks in this filter.</p>}
      <div className="table-wrap import-table-wrap">
        <table>
          <thead>
            <tr>
              {columns[0] && <th>#</th>}
              {columns[1] && <th>Status</th>}
              {columns[2] && <th>Source track</th>}
              {stage === "match" ? (
                <>
                  {columns[3] && <th>Matched recording</th>}
                  {columns[4] && <th>Method</th>}
                </>
              ) : (
                <>
                  {columns[3] && <th>Lidarr matched</th>}
                  {columns[4] && <th>Library state</th>}
                </>
              )}
              {columns[5] && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.id}>
                {columns[0] && <td>{row.position + 1}</td>}
                {columns[1] && (
                  <td>
                    <span className="badge">{row.state.replaceAll("_", " ")}</span>
                  </td>
                )}
                {columns[2] && (
                  <td>
                    <strong>{row.title}</strong>
                    <small>
                      {row.artists.join(", ")}
                      {row.album && ` · ${row.album}`}
                    </small>
                  </td>
                )}
                {stage === "match" ? (
                  <>
                    {columns[3] && (
                      <td>
                        <strong>{row.matchedTitle || "Not matched"}</strong>
                        <small>{row.matchedArtists?.join(", ")}</small>
                      </td>
                    )}
                    {columns[4] && <td>{row.method ?? "—"}</td>}
                  </>
                ) : (
                  <>
                    {columns[3] && (
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
                    )}
                    {columns[4] && (
                      <td>
                        <LibraryState classification={row.libraryClassification} path={row.libraryPath} />
                      </td>
                    )}
                  </>
                )}
                {columns[5] && (
                  <td>
                    <Link href={`/entries/${row.id}/review`}>Review</Link>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function LibraryState({ classification, path }: { classification?: string; path?: string }) {
  if (!classification) return <span className="status attention">Not refreshed</span>;
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
        <small>Release exists and is monitored, but this recording has not downloaded yet.</small>
      </>
    );
  return (
    <>
      <span className="status attention">Not downloadable</span>
      <small>{classification.replaceAll("_", " ")}</small>
    </>
  );
}
