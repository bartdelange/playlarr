"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { LidarrPlanRow } from "../../server/application/lidarr-plan-view";

const reasons: Record<string, string> = {
  musicbrainz_unresolved:
    "No validated MusicBrainz recording is bound to this song.",
  release_group_unresolved:
    "The recording has no selected MusicBrainz release group.",
  various_artists_skipped:
    "Various Artists is excluded to avoid adding or broadly monitoring compilation artists.",
  various_artists_album:
    "This release is a Various Artists compilation and is excluded by the Lidarr safety policy.",
  artist_missing: "The artist is not yet present in Lidarr.",
  release_missing: "This specific release is not yet present in Lidarr.",
  requested_release:
    "This is the release selected for a missing playlist song.",
  requested_track_missing:
    "The selected recording is not downloaded in Lidarr.",
  downloaded_recording_match:
    "Lidarr already has this recording on the named release.",
  release_exists_globally:
    "The release already exists elsewhere in the Lidarr library.",
  already_monitored:
    "The release is already monitored; no configuration change is needed.",
  already_downloaded_and_monitored:
    "The recording is downloaded and the release is already monitored.",
  already_reconciled: "No Lidarr changes are needed for this artist.",
  requested_recording_downloaded:
    "The requested recording file already exists; monitoring is not changed.",
  monitored_with_new_items_disabled:
    "Monitor this artist only for explicitly selected releases; automatic new-release monitoring remains disabled.",
};

const actionGuide = [
  [
    "unchanged",
    "No change",
    "The selected release is already represented and configured in Lidarr.",
  ],
  [
    "reuse_downloaded_release",
    "Reuse downloaded release",
    "Bind the song to the release whose downloaded file already contains this recording; no Lidarr mutation by itself.",
  ],
  [
    "reuse_existing_release",
    "Reuse existing release",
    "Use an album already present in Lidarr; no duplicate album is created.",
  ],
  [
    "create_artist",
    "Create artist",
    "Add the MusicBrainz artist to Lidarr, initially without monitoring unrelated releases.",
  ],
  [
    "create_release",
    "Create release",
    "Add this specific MusicBrainz album, EP, or single to Lidarr.",
  ],
  [
    "monitor_artist",
    "Monitor artist",
    "Monitor the artist while keeping new-item monitoring disabled.",
  ],
  [
    "monitor_release",
    "Monitor release",
    "Turn monitoring on only when a requested recording is missing and must be acquired.",
  ],
  [
    "queue_search",
    "Queue search",
    "Ask Lidarr to search its indexers for the selected release.",
  ],
  [
    "skip",
    "Skip",
    "Make no Lidarr change because the binding is unresolved or excluded by a safety rule.",
  ],
] as const;

export function LidarrPlanTable({
  rows,
  planId,
  planStatus,
  csrf,
  retryAction,
  allowVariousArtistsAction,
  changeReleaseAction,
}: {
  rows: LidarrPlanRow[];
  planId: string;
  planStatus: string;
  csrf: string;
  retryAction: (form: FormData) => void | Promise<void>;
  allowVariousArtistsAction: (form: FormData) => void | Promise<void>;
  changeReleaseAction: (form: FormData) => void | Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const columnLabels = [
    "#",
    "Status",
    "Source track",
    "Lidarr album / release",
    "Plan",
    "Actions",
  ];
  const [columns, setColumns] = useState(() => columnLabels.map(() => true));
  const editable = ["draft", "superseded"].includes(planStatus);
  const visible = useMemo(
    () =>
      rows.filter((row) => {
        const search = [
          row.entry.track.title,
          ...row.entry.track.artists,
          row.entry.track.album,
          row.entry.result.recordingTitle,
          ...(row.entry.result.artistNames ?? []),
          ...row.releases.flatMap((release) => [
            release.artistName,
            release.title,
          ]),
        ]
          .join(" ")
          .toLocaleLowerCase();
        const actionMatches =
          actionFilter === "all" ||
          (actionFilter === "mutates" && row.mutates) ||
          (actionFilter === "nonmutating" && !row.mutates) ||
          row.actionNames.includes(actionFilter);
        return search.includes(query.toLocaleLowerCase()) && actionMatches;
      }),
    [actionFilter, query, rows],
  );

  return (
    <>
      <details className="action-guide">
        <summary>What do the plan actions do?</summary>
        <div className="action-guide-grid">
          {actionGuide.map(([action, label, effect]) => (
            <div key={action}>
              <span className={`badge plan-${action}`}>{label}</span>
              <p>{effect}</p>
            </div>
          ))}
        </div>
      </details>
      <div className="mapping-filters">
        <input
          aria-label="Filter Lidarr mappings"
          placeholder="Filter by song, artist, or album…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          aria-label="Filter by plan action"
          value={actionFilter}
          onChange={(event) => setActionFilter(event.target.value)}
        >
          <option value="all">All actions</option>
          <option value="mutates">All Lidarr mutations</option>
          <option value="nonmutating">No mutation / reuse</option>
          <option value="queue_search">Searches queued</option>
          <option value="skip">Skipped</option>
          <option value="unchanged">No change</option>
          <option value="reuse_downloaded_release">
            Reuse downloaded release
          </option>
          <option value="reuse_existing_release">Reuse existing release</option>
          <option value="create_artist">Create artist</option>
          <option value="create_release">Create release</option>
          <option value="monitor_artist">Monitor artist</option>
          <option value="monitor_release">Monitor release</option>
        </select>
        <span className="muted">{visible.length} songs</span>
      </div>
      <details className="column-picker">
        <summary>Choose visible columns</summary>
        <div className="column-options">
          {columnLabels.map((label, index) => (
            <label key={label}>
              <input
                type="checkbox"
                checked={columns[index]}
                onChange={(event) =>
                  setColumns((current) =>
                    current.map((value, currentIndex) =>
                      currentIndex === index ? event.target.checked : value,
                    ),
                  )
                }
              />
              {label}
            </label>
          ))}
        </div>
      </details>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {columnLabels.map((label, index) =>
                columns[index] ? <th key={label}>{label}</th> : null,
              )}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.entry.id}>
                {columns[0] && <td>{row.entry.position + 1}</td>}
                {columns[1] && (
                  <td>
                    <span className="badge">
                      {row.entry.resolutionState.replaceAll("_", " ")}
                    </span>
                  </td>
                )}
                {columns[2] && (
                  <td>
                    <strong>{row.entry.track.title}</strong>
                    <small>
                      {row.entry.track.artists.join(", ")}
                      {row.entry.track.album && ` · ${row.entry.track.album}`}
                    </small>
                  </td>
                )}
                {columns[3] && (
                  <td>
                    {row.releases.length ? (
                      row.releases.map((release) => (
                        <div className="release-link" key={release.sourceGroup}>
                          <strong>
                            {text(release.matchedTrack?.title) ||
                              row.entry.result.recordingTitle ||
                              row.entry.track.title}
                          </strong>
                          <small>
                            {release.artistName ||
                              row.entry.track.artists.join(", ") ||
                              "Unknown artist"}{" "}
                            ·{" "}
                            {release.title ||
                              row.entry.track.album ||
                              "Lidarr release"}
                          </small>
                          {release.matchedTrack && (
                            <div className="matched-lidarr-track">
                              <span className="eyebrow">
                                Matched Lidarr track
                              </span>
                              <small>
                                {text(release.matchedTrack.track_number) &&
                                  `Track ${text(release.matchedTrack.track_number)} · `}
                                {release.matchedTrack.has_file
                                  ? "File downloaded"
                                  : "No file"}
                                {release.matchedTrack.track_file_id
                                  ? ` · Lidarr file ${text(release.matchedTrack.track_file_id)}`
                                  : ""}
                              </small>
                            </div>
                          )}
                          {release.sourceGroup !== release.lidarrGroup && (
                            <small>
                              Rebound because this Lidarr release contains the
                              selected track.
                            </small>
                          )}
                        </div>
                      ))
                    ) : (
                      <span className="status attention">
                        No Lidarr release
                      </span>
                    )}
                  </td>
                )}
                {columns[4] && (
                  <td>
                    {row.actions.length ? (
                      row.actions.map((action, index) => (
                        <div
                          className="plan-decision"
                          key={`${action.action}-${index}`}
                        >
                          <span className={`badge plan-${action.action}`}>
                            {action.action.replaceAll("_", " ")}
                          </span>
                          {row.artistActions.includes(action) && (
                            <small className="action-scope">
                              Artist-level action · shared by this artist&apos;s
                              requested songs
                            </small>
                          )}
                          <small>
                            {reasons[action.reason ?? ""] ??
                              action.reason?.replaceAll("_", " ")}
                          </small>
                        </div>
                      ))
                    ) : row.entry.result.resolvedVia && row.releases.length ? (
                      <>
                        <span className="badge plan-unchanged">
                          No explicit action
                        </span>
                        <small>
                          Rebuild this older plan for an explicit unchanged
                          outcome.
                        </small>
                      </>
                    ) : (
                      <>
                        <span className="badge plan-skip">Skipped</span>
                        <small>
                          {!row.entry.result.resolvedVia
                            ? reasons.musicbrainz_unresolved
                            : "No release is selected for this recording."}
                        </small>
                      </>
                    )}
                  </td>
                )}
                {columns[5] && (
                  <td className="binding-actions">
                    {editable && (
                      <Link
                        href={`/entries/${row.entry.id}/review?plan_id=${planId}`}
                      >
                        {row.entry.result.resolvedVia
                          ? "Change track"
                          : "Resolve track"}
                      </Link>
                    )}
                    {row.variousArtistsOverride ? (
                      <span className="badge plan-monitor_release">
                        VA safety override queued
                      </span>
                    ) : (
                      row.variousArtistsSkip && (
                        <>
                          {editable && (
                            <ActionForm
                              action={retryAction}
                              csrf={csrf}
                              entryId={row.entry.id}
                              planId={planId}
                              label="Retry automatic search"
                            />
                          )}
                          <ActionForm
                            action={allowVariousArtistsAction}
                            csrf={csrf}
                            entryId={row.entry.id}
                            planId={planId}
                            label="Allow this VA release"
                          />
                        </>
                      )
                    )}
                    {editable &&
                      (row.entry.result.releaseGroupIds?.length ?? 0) > 1 && (
                        <form action={changeReleaseAction}>
                          <input type="hidden" name="csrf_token" value={csrf} />
                          <input
                            type="hidden"
                            name="entry_id"
                            value={row.entry.id}
                          />
                          <input type="hidden" name="plan_id" value={planId} />
                          <select
                            aria-label={`Release group for ${row.entry.track.title}`}
                            name="release_group_id"
                            defaultValue={row.entry.selectedReleaseGroupId}
                          >
                            {row.entry.result.releaseGroupIds?.map((group) => (
                              <option key={group}>{group}</option>
                            ))}
                          </select>
                          <button className="secondary">Use release</button>
                        </form>
                      )}
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

function ActionForm({
  action,
  csrf,
  entryId,
  planId,
  label,
}: {
  action: (form: FormData) => void | Promise<void>;
  csrf: string;
  entryId: number;
  planId: string;
  label: string;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="csrf_token" value={csrf} />
      <input type="hidden" name="entry_id" value={entryId} />
      <input type="hidden" name="plan_id" value={planId} />
      <button className="secondary">{label}</button>
    </form>
  );
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}
