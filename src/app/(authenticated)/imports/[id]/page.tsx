import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import type { LidarrPlanAction } from "../../../../server/domain/lidarr";
import { ImportRepository } from "../../../../server/persistence/import-repository";
import { database } from "../../../../server/runtime";
import { requestCsrfToken } from "../../../../server/security/request";
import {
  approveAndExecutePlan,
  deleteImport,
  queueLidarrPlan,
  queuePlaylistUpdatePreview,
  queueResolution,
} from "../../../actions/workflows";
import { queuePlaylistGeneration } from "../../../actions/exports";
export default async function ImportPage({
  params,
}: {
  params: Promise<{ id: string }>;
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
      </section>
      <nav className="steps" aria-label="Workflow progress">
        <a
          className={currentStep === 1 ? "active" : "complete"}
          href="#music-match"
          aria-current={currentStep === 1 ? "step" : undefined}
        >
          1 Music match
        </a>
        {matchingComplete ? (
          <a
            className={currentStep === 2 ? "active" : "complete"}
            href="#lidarr-plan"
            aria-current={currentStep === 2 ? "step" : undefined}
          >
            2 Lidarr
          </a>
        ) : (
          <span className="disabled" aria-disabled="true">
            2 Lidarr
          </span>
        )}
        {finalAvailable ? (
          <a
            className={currentStep === 3 ? "active" : undefined}
            href="#final-library"
            aria-current={currentStep === 3 ? "step" : undefined}
          >
            3 Final
          </a>
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
            {currentStep === 1
              ? "Music match"
              : currentStep === 2
                ? "Lidarr planning"
                : "Final & library"}
          </h2>
        </div>
        <div className="actions">
          <form action={queuePlaylistUpdatePreview}>
            <input type="hidden" name="csrf_token" value={csrf} />
            <input type="hidden" name="import_id" value={id} />
            <button>Check source updates</button>
          </form>
          {["library_status", "playlist_generated"].includes(
            imported.workflowState,
          ) && (
            <form action={queuePlaylistGeneration}>
              <input type="hidden" name="csrf_token" value={csrf} />
              <input type="hidden" name="import_id" value={id} />
              <button>Generate M3U8</button>
            </form>
          )}
          {["ready_to_resolve", "review_required"].includes(
            imported.workflowState,
          ) && (
            <form action={queueResolution}>
              <input type="hidden" name="csrf_token" value={csrf} />
              <input type="hidden" name="import_id" value={id} />
              <button>Resolve tracks</button>
            </form>
          )}
          {["ready_to_plan", "plan_ready", "execution_failed"].includes(
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
      <section id="music-match">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Tracks</p>
            <h2>Music matching</h2>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>State</th>
                <th>Track</th>
                <th>Album</th>
                <th>Review</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.position + 1}</td>
                  <td>{entry.resolutionState.replaceAll("_", " ")}</td>
                  <td>
                    <strong>{entry.track.title}</strong>
                    <small>{entry.track.artists.join(", ")}</small>
                  </td>
                  <td>{entry.track.album}</td>
                  <td>
                    <Link href={`/entries/${entry.id}/review`}>Review</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {planHeader && (
        <section id="lidarr-plan">
          <h2>
            Lidarr plan <span className="badge">{planHeader.status}</span>
          </h2>
          <p>
            Planning is read-only. Approval authorizes exactly these actions;
            execution revalidates Lidarr immediately before mutation.
          </p>
          <div className="card-list">
            {planActions.map((action, index) => (
              <article className="card" key={index}>
                <strong>{action.action.replaceAll("_", " ")}</strong>
                <span>{action.artistName || action.artistMbid}</span>
                <small>
                  {action.albumTitle || action.releaseGroupId}{" "}
                  {action.reason && `· ${action.reason.replaceAll("_", " ")}`}
                </small>
              </article>
            ))}
          </div>
          {planHeader.status === "draft" && (
            <form action={approveAndExecutePlan}>
              <input type="hidden" name="csrf_token" value={csrf} />
              <input type="hidden" name="plan_id" value={planHeader.id} />
              <button>Approve and execute plan</button>
            </form>
          )}
        </section>
      )}
      {finalAvailable && (
        <section id="final-library" className="card">
          <p className="eyebrow">Final</p>
          <h2>Library & export</h2>
          <p className="muted">
            Refresh downloaded files, add local tracks, then generate the
            ordered M3U8 playlist.
          </p>
          <div className="actions">
            <Link
              className="button secondary"
              href={`/imports/${id}/local-additions`}
            >
              Local additions
            </Link>
          </div>
        </section>
      )}
      <form className="actions" action={deleteImport}>
        <input type="hidden" name="csrf_token" value={csrf} />
        <input type="hidden" name="import_id" value={id} />
        <button className="danger">Delete import and history</button>
      </form>
    </main>
  );
}
