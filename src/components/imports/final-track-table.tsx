"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type {
  FinalExecutionNote,
  FinalTableRow,
  LibraryAvailability,
} from "../../server/application/final-table-view";
import {
  filterFinalRows,
  finalAvailabilityCounts,
} from "../../server/application/final-table-view";

const columnLabels = [
  "#",
  "Status",
  "Source track",
  "Lidarr matched",
  "Library state",
  "Actions",
];

export function FinalTrackTable({ rows }: { rows: FinalTableRow[] }) {
  const [filter, setFilter] = useState<"all" | LibraryAvailability>("all");
  const [columns, setColumns] = useState(() => columnLabels.map(() => true));
  const counts = useMemo(() => finalAvailabilityCounts(rows), [rows]);
  const visibleRows = filterFinalRows(rows, filter);
  const filters = [
    [
      "all",
      `All (${counts.downloaded + counts.downloadable + counts.not_downloadable})`,
    ],
    ["downloaded", `Downloaded (${counts.downloaded})`],
    ["downloadable", `Missing but downloadable (${counts.downloadable})`],
    ["not_downloadable", `Not downloadable (${counts.not_downloadable})`],
  ] as const;

  return (
    <>
      <div className="filters" aria-label="Final track filters">
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
      {visibleRows.length === 0 && (
        <p className="empty-filter">No tracks in this filter.</p>
      )}
      <details className="column-picker">
        <summary>Choose visible columns</summary>
        <div className="column-options">
          {columnLabels.map((label, index) => (
            <label key={label}>
              <input
                checked={columns[index]}
                onChange={(event) =>
                  setColumns((current) =>
                    current.map((value, currentIndex) =>
                      currentIndex === index ? event.target.checked : value,
                    ),
                  )
                }
                type="checkbox"
              />
              {label}
            </label>
          ))}
        </div>
      </details>
      <div className="table-wrap final-table-wrap">
        <table>
          <thead>
            <tr>
              {columnLabels.map((label, index) =>
                columns[index] ? <th key={label}>{label}</th> : null,
              )}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.id}>
                {columns[0] && <td>{row.position + 1}</td>}
                {columns[1] && (
                  <td>
                    <span className="badge">
                      {row.resolutionState.replaceAll("_", " ")}
                    </span>
                  </td>
                )}
                {columns[2] && (
                  <td>
                    <strong>{row.track.title}</strong>
                    <small>
                      {row.track.artists.join(", ")}
                      {row.track.album && ` · ${row.track.album}`}
                    </small>
                  </td>
                )}
                {columns[3] && (
                  <td>
                    {row.lidarrMatch ? (
                      <MatchedLidarrTrack match={row.lidarrMatch} />
                    ) : (
                      <span className="muted">No matched Lidarr track</span>
                    )}
                  </td>
                )}
                {columns[4] && (
                  <td>
                    <LibraryState row={row} />
                  </td>
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

function MatchedLidarrTrack({
  match,
}: {
  match: NonNullable<FinalTableRow["lidarrMatch"]>;
}) {
  return (
    <div className="matched-lidarr-track">
      <span className="eyebrow">Matched Lidarr track</span>
      <strong>{match.title}</strong>
      <small>
        {match.trackNumber && `Track ${match.trackNumber} · `}
        {match.foreignRecordingId && (
          <>
            <a
              href={`https://musicbrainz.org/recording/${match.foreignRecordingId}`}
              target="_blank"
              rel="noreferrer"
            >
              Recording {match.foreignRecordingId}
            </a>{" "}
            ·{" "}
          </>
        )}
        {match.matchMethod === "recording_id"
          ? "Exact recording ID"
          : "Normalized title fallback"}{" "}
        · {match.hasFile ? "File downloaded" : "No file"}
        {match.trackFileId && ` · Lidarr file ${match.trackFileId}`}
      </small>
      {match.releaseGroupId && <small>{match.albumTitle}</small>}
    </div>
  );
}

function LibraryState({ row }: { row: FinalTableRow }) {
  if (row.availability === "not_refreshed")
    return <span className="status attention">Not refreshed</span>;
  return (
    <>
      <span
        className={`status ${row.availability === "downloaded" ? "ok" : "attention"}`}
      >
        {row.availability === "downloaded"
          ? "Downloaded"
          : row.availability === "downloadable"
            ? "Missing but downloadable"
            : "Not downloadable"}
      </span>
      {row.availability === "downloaded" && row.libraryPath ? (
        <small>{row.libraryPath}</small>
      ) : (
        row.libraryClassification && (
          <small>{classificationExplanation(row)}</small>
        )
      )}
      {row.availability !== "downloaded" &&
        row.executionNotes.map((note, index) =>
          showExecutionNote(note) ? (
            <small className="execution-note" key={`${note.action}-${index}`}>
              <strong>
                {note.action.replaceAll("_", " ")}: {note.outcome}
              </strong>
              {(note.details || note.reason) &&
                ` — ${(note.details || note.reason)?.replaceAll("_", " ")}`}
            </small>
          ) : null,
        )}
    </>
  );
}

function classificationExplanation(row: FinalTableRow) {
  if (
    row.executionNotes.some((note) => note.reason === "various_artists_album")
  )
    return "Not added: selected release is a Various Artists compilation excluded by the safety policy.";
  const explanations: Record<string, string> = {
    release_monitored_missing:
      "Release exists and is monitored, but this recording has not downloaded yet.",
    release_unmonitored_missing:
      "Release exists but is unmonitored and this recording has no file.",
    release_missing: "Selected release is not currently present in Lidarr.",
    artist_missing: "Artist is not currently present in Lidarr.",
  };
  return (
    explanations[row.libraryClassification ?? ""] ??
    row.libraryClassification?.replaceAll("_", " ")
  );
}

function showExecutionNote(note: FinalExecutionNote) {
  return (
    note.outcome === "failed" ||
    note.reason === "various_artists_album" ||
    ["create_release", "monitor_release", "queue_search"].includes(note.action)
  );
}
