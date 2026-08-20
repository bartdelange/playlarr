import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import type { LidarrPlanAction } from "../../../../server/domain/lidarr";
import type { MusicBrainzResult } from "../../../../server/domain/musicbrainz";
import { ImportRepository } from "../../../../server/persistence/import-repository";
import { database } from "../../../../server/runtime";
import { requestCsrfToken } from "../../../../server/security/request";
import { ImportTrackTable } from "../../../../components/imports/import-track-table";
import {
  approveAndExecutePlan,
  deleteImport,
  queueLidarrPlan,
  queuePlaylistUpdatePreview,
  queueResolution,
} from "../../../actions/workflows";
import {
  queueLibraryStatus,
  queuePlaylistGeneration,
} from "../../../actions/exports";
export default async function ImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ stage?: string }>;
}) {
  await connection();
  const { id } = await params;
  const repository = new ImportRepository(database);
  let imported;
  try {
    imported = repository.getImport(id);
  } catch {
    notFound();
  }
  const entries = repository.entries(id);
  const trackDetails = new Map(
    (
      database
        .prepare(
          `SELECT e.id, r.method, r.result_json, l.classification, l.file_path
           FROM playlist_entries e
           JOIN resolutions r ON r.entry_id = e.id
           LEFT JOIN library_status l ON l.entry_id = e.id
           WHERE e.import_id = ?
           ORDER BY e.position`,
        )
        .all(id) as {
        id: number;
        method: string | null;
        result_json: string;
        classification: string | null;
        file_path: string | null;
      }[]
    ).map((row) => [
      row.id,
      {
        method: row.method ?? undefined,
        result: JSON.parse(row.result_json) as MusicBrainzResult,
        libraryClassification: row.classification ?? undefined,
        libraryPath: row.file_path ?? undefined,
      },
    ]),
  );
  const csrf = await requestCsrfToken();
  const planHeader = database
    .prepare(
      "SELECT id, status FROM lidarr_plans WHERE import_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .get(id) as { id: string; status: string } | undefined;
  const planActions = planHeader
    ? (
        database
          .prepare(
            "SELECT action_json FROM lidarr_plan_actions WHERE plan_id = ? ORDER BY position",
          )
          .all(planHeader.id) as { action_json: string }[]
      ).map((row) => JSON.parse(row.action_json) as LidarrPlanAction)
    : [];
  const matchingComplete = ![
    "acquired",
    "ready_to_resolve",
    "resolving",
    "review_required",
  ].includes(imported.workflowState);
  const finalAvailable = [
    "waiting_for_downloads",
    "library_status",
    "playlist_generated",
  ].includes(imported.workflowState);
  const currentStep = finalAvailable ? 3 : matchingComplete ? 2 : 1;
  const requestedStage = (await searchParams).stage;
  const stage =
    requestedStage === "final" && finalAvailable
      ? "final"
      : requestedStage === "lidarr" && matchingComplete
        ? "lidarr"
        : "match";
  return (
    <main>
      <section className="playlist-context">
        <div>
          <div className="playlist-meta">
            <span className="badge">{imported.source}</span>
            <span>{entries.length} tracks</span>
            <span className="badge">
              {imported.workflowState.replaceAll("_", " ")}
            </span>
          </div>
          <h1>{imported.playlistName}</h1>
        </div>
        <div className="actions playlist-actions">
          <form action={queuePlaylistUpdatePreview}>
            <input type="hidden" name="csrf_token" value={csrf} />
            <input type="hidden" name="import_id" value={id} />
            <button className="secondary">Refresh playlist</button>
          </form>
          <form action={deleteImport}>
            <input type="hidden" name="csrf_token" value={csrf} />
            <input type="hidden" name="import_id" value={id} />
            <button className="secondary">Delete import</button>
          </form>
        </div>
      </section>
      <nav className="steps" aria-label="Workflow progress">
        <Link
          className={stage === "match" ? "active" : "complete"}
          href={`/imports/${id}?stage=match`}
          aria-current={stage === "match" ? "step" : undefined}
        >
          1 Music match
        </Link>
        {matchingComplete ? (
          <Link
            className={
              stage === "lidarr"
                ? "active"
                : currentStep > 2
                  ? "complete"
                  : undefined
            }
            href={`/imports/${id}?stage=lidarr`}
            aria-current={stage === "lidarr" ? "step" : undefined}
          >
            2 Lidarr
          </Link>
        ) : (
          <span className="disabled" aria-disabled="true">
            2 Lidarr
          </span>
        )}
        {finalAvailable ? (
          <Link
            className={stage === "final" ? "active" : undefined}
            href={`/imports/${id}?stage=final`}
            aria-current={stage === "final" ? "step" : undefined}
          >
            3 Final
          </Link>
        ) : (
          <span className="disabled" aria-disabled="true">
            3 Final
          </span>
        )}
      </nav>
      {imported.lastError && <p role="alert">{imported.lastError}</p>}
      <section className="step-actions">
        <div>
          <p className="eyebrow">Current step</p>
          <h2>
            {stage === "match"
              ? "Music match"
              : stage === "lidarr"
                ? "Lidarr plan"
                : "Final"}
          </h2>
        </div>
        <div className="actions">
          {stage === "final" &&
            ["library_status", "playlist_generated"].includes(
              imported.workflowState,
            ) && (
              <>
                <form action={queueLibraryStatus}>
                  <input type="hidden" name="csrf_token" value={csrf} />
                  <input type="hidden" name="import_id" value={id} />
                  <button>Refresh monitored &amp; downloaded</button>
                </form>
                <Link
                  className="button secondary"
                  href={`/imports/${id}/local-additions`}
                >
                  Local additions
                </Link>
                <form action={queuePlaylistGeneration}>
                  <input type="hidden" name="csrf_token" value={csrf} />
                  <input type="hidden" name="import_id" value={id} />
                  <button className="secondary">Export M3U</button>
                </form>
              </>
            )}
          {stage === "match" &&
            ["ready_to_resolve", "review_required"].includes(
              imported.workflowState,
            ) && (
              <form action={queueResolution}>
                <input type="hidden" name="csrf_token" value={csrf} />
                <input type="hidden" name="import_id" value={id} />
                <button>Resolve tracks</button>
              </form>
            )}
          {stage === "lidarr" &&
            ["ready_to_plan", "plan_ready", "execution_failed"].includes(
              imported.workflowState,
            ) && (
              <form action={queueLidarrPlan}>
                <input type="hidden" name="csrf_token" value={csrf} />
                <input type="hidden" name="import_id" value={id} />
                <button>Build Lidarr plan</button>
              </form>
            )}
        </div>
      </section>
      {stage === "match" && (
        <section id="music-match">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Tracks</p>
              <h2>Music matching</h2>
            </div>
          </div>
          <ImportTrackTable
            rows={entries.map((entry) => ({
              id: entry.id,
              position: entry.position,
              state: entry.resolutionState,
              title: entry.track.title,
              artists: entry.track.artists,
              album: entry.track.album,
              method: trackDetails.get(entry.id)?.method,
              matchedTitle: trackDetails.get(entry.id)?.result.recordingTitle,
              matchedArtists: trackDetails.get(entry.id)?.result.artistNames,
            }))}
          />
        </section>
      )}
      {stage === "lidarr" && planHeader && (
        <section id="lidarr-plan">
          <h2>
            Lidarr plan <span className="badge">{planHeader.status}</span>
          </h2>
          <p>
            Planning is read-only. Approval authorizes exactly these actions;
            execution revalidates Lidarr immediately before mutation.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Artist</th>
                  <th>Release</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {planActions.map((action, index) => (
                  <tr key={index}>
                    <td>
                      <span className="badge">
                        {action.action.replaceAll("_", " ")}
                      </span>
                    </td>
                    <td>{action.artistName || action.artistMbid || "—"}</td>
                    <td>{action.albumTitle || action.releaseGroupId || "—"}</td>
                    <td>{action.reason?.replaceAll("_", " ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {planHeader.status === "draft" && (
            <form action={approveAndExecutePlan}>
              <input type="hidden" name="csrf_token" value={csrf} />
              <input type="hidden" name="plan_id" value={planHeader.id} />
              <button>Apply to Lidarr</button>
            </form>
          )}
        </section>
      )}
      {stage === "lidarr" && !planHeader && (
        <div className="next-step">
          <div>
            <strong>No Lidarr plan exists yet.</strong>
            <span>Create a read-only preview before applying changes.</span>
          </div>
        </div>
      )}
      {stage === "final" && finalAvailable && (
        <section id="final-library">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Tracks</p>
              <h2>Library &amp; export</h2>
            </div>
          </div>
          <ImportTrackTable
            stage="final"
            rows={entries.map((entry) => ({
              id: entry.id,
              position: entry.position,
              state: entry.resolutionState,
              title: entry.track.title,
              artists: entry.track.artists,
              album: entry.track.album,
              method: trackDetails.get(entry.id)?.method,
              matchedTitle: trackDetails.get(entry.id)?.result.recordingTitle,
              matchedArtists: trackDetails.get(entry.id)?.result.artistNames,
              libraryClassification: trackDetails.get(entry.id)
                ?.libraryClassification,
              libraryPath: trackDetails.get(entry.id)?.libraryPath,
            }))}
          />
        </section>
      )}
    </main>
  );
}
