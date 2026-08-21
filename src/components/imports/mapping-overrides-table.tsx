"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { MappingOverrideCandidate } from "../../server/persistence/mapping-overrides-repository";

const labels = {
  conflict: "Conflicting source mappings",
  already_same: "Already the same",
  will_override: "Overrides existing",
  will_map: "Maps unresolved",
};

export function MappingOverridesTable({
  candidates,
  importId,
  sourceImportId,
  sourceName,
  csrf,
  action,
}: {
  candidates: MappingOverrideCandidate[];
  importId: string;
  sourceImportId: string;
  sourceName: string;
  csrf: string;
  action: (form: FormData) => void | Promise<void>;
}) {
  const selectable = candidates.filter((candidate) => ["will_override", "will_map"].includes(candidate.status));
  const [selected, setSelected] = useState(() => new Set(selectable.map((candidate) => candidate.target.id)));
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState("all");
  const [state, setState] = useState("all");
  const visible = useMemo(
    () =>
      candidates.filter((candidate) => {
        const accepted = selected.has(candidate.target.id);
        const search = [
          candidate.target.track.title,
          ...candidate.target.track.artists,
          candidate.target.track.album,
          candidate.target.track.isrc,
        ]
          .join(" ")
          .toLocaleLowerCase();
        return (
          search.includes(query.toLocaleLowerCase()) &&
          (selection === "all" || (selection === "accepted" && accepted) || (selection === "ignored" && !accepted)) &&
          (state === "all" || candidate.status === state)
        );
      }),
    [candidates, query, selected, selection, state],
  );

  return (
    <form action={action}>
      <input type="hidden" name="csrf_token" value={csrf} />
      <input type="hidden" name="import_id" value={importId} />
      <input type="hidden" name="source_import_id" value={sourceImportId} />
      <div className="mapping-filters">
        <input
          aria-label="Filter mapping overrides"
          placeholder="Filter by title, artist, album, or ISRC…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          aria-label="Filter by selection"
          value={selection}
          onChange={(event) => setSelection(event.target.value)}
        >
          <option value="all">Accepted and ignored</option>
          <option value="accepted">Accepted</option>
          <option value="ignored">Ignored</option>
        </select>
        <select aria-label="Filter by mapping state" value={state} onChange={(event) => setState(event.target.value)}>
          <option value="all">All mapping states</option>
          <option value="will_override">Overrides existing</option>
          <option value="will_map">Maps unresolved</option>
          <option value="already_same">Already the same</option>
          <option value="conflict">Conflicting source mappings</option>
        </select>
        <span className="muted">
          {visible.length} shown · {selected.size} accepted
        </span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Accept</th>
              <th>Target track</th>
              <th>Current mapping</th>
              <th>Mapping from {sourceName}</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((candidate) => {
              const enabled = ["will_override", "will_map"].includes(candidate.status);
              return (
                <tr key={candidate.target.id}>
                  <td>
                    <input
                      className="checkbox"
                      type="checkbox"
                      name="target_entry_ids"
                      value={candidate.target.id}
                      checked={selected.has(candidate.target.id)}
                      disabled={!enabled}
                      onChange={(event) =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(candidate.target.id);
                          else next.delete(candidate.target.id);
                          return next;
                        })
                      }
                    />
                  </td>
                  <td>
                    <strong>{candidate.target.track.title}</strong>
                    <small>
                      {candidate.target.track.artists.join(", ")} · {candidate.target.track.isrc}
                    </small>
                  </td>
                  <td>
                    {candidate.targetResult.recordingTitle || "Not mapped"}
                    <small>{(candidate.targetResult.recordingIds ?? []).join(", ")}</small>
                  </td>
                  <td>
                    <strong>{candidate.sourceResult.recordingTitle}</strong>
                    <small>
                      {(candidate.sourceResult.artistNames ?? []).join(", ")} ·{" "}
                      {(candidate.sourceResult.recordingIds ?? []).join(", ")}
                    </small>
                  </td>
                  <td>
                    <span className="badge">{labels[candidate.status]}</span>
                    {candidate.status === "conflict" && (
                      <small>Source import has different mappings for this ISRC; resolve it there first.</small>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="actions mapping-override-actions">
        <button disabled={!selected.size}>Apply selected overrides</button>
        <Link className="button secondary" href={`/imports/${importId}?stage=match`}>
          Cancel
        </Link>
      </div>
      {!candidates.length && <p className="empty">No exact ISRC matches with resolved source mappings were found.</p>}
    </form>
  );
}
