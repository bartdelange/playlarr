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
};

const reviewStates = new Set(["unresolved", "ambiguous", "validation_failed"]);

export function ImportTrackTable({ rows }: { rows: TrackRow[] }) {
  const [filter, setFilter] = useState("all");
  const [columns, setColumns] = useState({ state: true, album: true });
  const visibleRows = useMemo(
    () =>
      rows.filter((row) => {
        if (filter === "review") return reviewStates.has(row.state);
        if (filter === "automatic")
          return row.state === "automatically_resolved";
        if (filter === "manual") return row.state === "manually_resolved";
        return true;
      }),
    [filter, rows],
  );

  return (
    <>
      <div className="filters" aria-label="Track filters">
        {[
          ["all", `All (${rows.length})`],
          ["review", "Needs review"],
          ["automatic", "Automatic"],
          ["manual", "Manual"],
        ].map(([value, label]) => (
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
              {columns.album && <th>Album</th>}
              <th>Method</th>
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
                  <small>{row.artists.join(", ")}</small>
                </td>
                {columns.album && <td>{row.album || "—"}</td>}
                <td>{row.method?.replaceAll("_", " ") ?? "—"}</td>
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
