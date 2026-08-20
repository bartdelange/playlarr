import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { MusicBrainzResult } from "../../../../server/domain/musicbrainz";
import { ImportRepository } from "../../../../server/persistence/import-repository";
import { LidarrPlanRepository } from "../../../../server/persistence/lidarr-plan-repository";
import { database } from "../../../../server/runtime";
import { requestCsrfToken } from "../../../../server/security/request";
import { ImportTrackTable } from "../../../../components/imports/import-track-table";
import { FinalTrackTable } from "../../../../components/imports/final-track-table";
import { LidarrPlanTable } from "../../../../components/imports/lidarr-plan-table";
import { finalTableRows } from "../../../../server/application/final-table-view";
import {
  lidarrPlanRows,
  lidarrPlanSummary,
} from "../../../../server/application/lidarr-plan-view";
import { LibraryRepository } from "../../../../server/persistence/library-repository";
import {
  allowVariousArtistsRelease,
  approveAndExecutePlan,
  changeLidarrPlanRelease,
  deleteImport,
  queueLidarrPlan,
  queuePlaylistUpdatePreview,
  queueResolution,
  retryLidarrPlanEntry,
} from "../../../actions/workflows";
import {
  queueLibraryStatus,
  queuePlaylistGeneration,
} from "../../../actions/exports";
export default function ImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ stage?: string }>;
}) {
  return (
    <main>
      <p className="eyebrow">Playlist workflow</p>
      <Suspense fallback={<ImportWorkflowSkeleton />}>
        <ImportWorkflowContent params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function ImportWorkflowContent({
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
  const musicMatchRecordings = repository.musicMatchRecordings(id);
  const hasMappingSources = repository
    .listImports()
    .some((candidate) => candidate.id !== id);
  const revisions = database
    .prepare(
      `SELECT id, created_at, added, removed, updated, moved
       FROM playlist_revisions
       WHERE import_id = ?
       ORDER BY created_at DESC`,
    )
    .all(id) as {
    id: string;
    created_at: string;
    added: number;
    removed: number;
    updated: number;
    moved: number;
  }[];
  const trackDetails = new Map(
    (
      database
        .prepare(
          `SELECT e.id, r.method, r.result_json, r.evidence_json,
                  r.selected_release_group_id, r.is_manual,
                  l.classification, l.file_path
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
        evidence_json: string;
        selected_release_group_id: string | null;
        is_manual: number;
        classification: string | null;
        file_path: string | null;
      }[]
    ).map((row) => [
      row.id,
      {
        method: row.method ?? undefined,
        result: JSON.parse(row.result_json) as MusicBrainzResult,
        evidence: JSON.parse(row.evidence_json) as Record<string, unknown>,
        selectedReleaseGroupId: row.selected_release_group_id ?? undefined,
        isManual: Boolean(row.is_manual),
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
  const plans = new LidarrPlanRepository(database);
  const planActions = planHeader ? plans.get(planHeader.id).plan.actions : [];
  const planSummary = lidarrPlanSummary({ actions: planActions });
  const latestExport = new LibraryRepository(database).latestExport(id);
  const lidarrResolutions = new Map(
    plans
      .planningResolutions(id)
      .map((resolution) => [resolution.entryId, resolution]),
  );
  const planRows = planHeader
    ? lidarrPlanRows(
        entries.map((entry) => {
          const details = trackDetails.get(entry.id);
          const resolution = lidarrResolutions.get(entry.id);
          return {
            id: entry.id,
            position: entry.position,
            resolutionState: entry.resolutionState,
            isManual: details?.isManual ?? entry.isManual,
            track: entry.track,
            result: resolution?.result ?? {},
            evidence: resolution?.evidence ?? {},
            selectedReleaseGroupId: resolution?.selectedReleaseGroupId,
          };
        }),
        { actions: planActions },
      )
    : [];
  const executionResults =
    planHeader && ["completed", "failed"].includes(planHeader.status)
      ? (database
          .prepare(
            `SELECT action_position, outcome, details
             FROM lidarr_execution_results
             WHERE plan_id = ?
             ORDER BY action_position`,
          )
          .all(planHeader.id) as {
          action_position: number;
          outcome: string;
          details: string | null;
        }[])
      : [];
  const finalRows = finalTableRows(
    entries.map((entry) => {
      const details = trackDetails.get(entry.id);
      const resolution = lidarrResolutions.get(entry.id);
      return {
        id: entry.id,
        position: entry.position,
        resolutionState: entry.resolutionState,
        track: entry.track,
        result: resolution?.result ?? {},
        libraryClassification: details?.libraryClassification,
        libraryPath: details?.libraryPath,
      };
    }),
    planActions,
    executionResults.map((result) => ({
      actionPosition: result.action_position,
      outcome: result.outcome,
      details: result.details ?? undefined,
    })),
  );
  const matchingComplete = ![
    "acquired",
    "ready_to_resolve",
    "resolving",
    "review_required",
  ].includes(imported.workflowState);
  const finalWorkflowActive = [
    "waiting_for_downloads",
    "library_status",
    "playlist_generated",
  ].includes(imported.workflowState);
  const finalAvailable = Boolean(planHeader);
  const currentStep = finalWorkflowActive ? 3 : matchingComplete ? 2 : 1;
  const requestedStage = (await searchParams).stage;
  const stage =
    requestedStage === "final" && finalAvailable
      ? "final"
      : requestedStage === "lidarr" && matchingComplete
        ? "lidarr"
        : requestedStage === "match"
          ? "match"
          : currentStep === 3
            ? "final"
            : currentStep === 2
              ? "lidarr"
              : "match";
  return (
    <>
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
          {hasMappingSources && (
            <Link
              className="button secondary"
              href={`/imports/${id}/mapping-overrides`}
            >
              Reuse mappings
            </Link>
          )}
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
          {stage === "lidarr" && planHeader && (
            <p>
              <span className="badge">{planHeader.status}</span>{" "}
              {planSummary.actions} actions · {planSummary.changes} changes
            </p>
          )}
        </div>
        <div className={`actions ${stage === "lidarr" ? "plan-actions" : ""}`}>
          {stage === "final" && (
            <>
              {finalWorkflowActive && (
                <form action={queueLibraryStatus}>
                  <input type="hidden" name="csrf_token" value={csrf} />
                  <input type="hidden" name="import_id" value={id} />
                  <button>Refresh monitored &amp; downloaded</button>
                </form>
              )}
              <Link
                className="button secondary"
                href={`/imports/${id}/local-additions`}
              >
                Local additions
              </Link>
              {["library_status", "playlist_generated"].includes(
                imported.workflowState,
              ) && (
                <form action={queuePlaylistGeneration}>
                  <input type="hidden" name="csrf_token" value={csrf} />
                  <input type="hidden" name="import_id" value={id} />
                  <button className="secondary">Export M3U</button>
                </form>
              )}
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
          {stage === "lidarr" && planHeader?.status === "draft" && (
            <form action={approveAndExecutePlan}>
              <input type="hidden" name="csrf_token" value={csrf} />
              <input type="hidden" name="plan_id" value={planHeader.id} />
              <button>Apply to Lidarr</button>
            </form>
          )}
          {stage === "lidarr" && planHeader?.status !== "approved" && (
            <form action={queueLidarrPlan}>
              <input type="hidden" name="csrf_token" value={csrf} />
              <input type="hidden" name="import_id" value={id} />
              <button className={planHeader ? "secondary" : undefined}>
                {planHeader ? "Rebuild Lidarr plan" : "Build Lidarr plan"}
              </button>
            </form>
          )}
          {stage === "lidarr" && planHeader && (
            <Link
              className="button secondary"
              href={`/imports/${id}?stage=final`}
            >
              Open final
            </Link>
          )}
        </div>
      </section>
      {stage === "lidarr" && planHeader?.status === "superseded" && (
        <div className="next-step">
          <div>
            <strong>Binding changes are queued.</strong>
            <span>
              This plan is now a stale reference and cannot be applied. Continue
              changing tracks, then rebuild once when you are finished.
            </span>
          </div>
        </div>
      )}
      {stage === "final" && planHeader && planHeader.status !== "completed" && (
        <div className="next-step">
          <div>
            <strong>There are unapplied Lidarr changes.</strong>
            <span>
              This Final view is provisional. Apply the active Lidarr plan, then
              refresh monitored and downloaded status.
            </span>
          </div>
          <Link className="button" href={`/imports/${id}?stage=lidarr`}>
            Open Lidarr plan
          </Link>
        </div>
      )}
      {stage === "final" &&
        planHeader?.status === "completed" &&
        latestExport && (
          <div className="card playlist-result">
            <div>
              <p className="eyebrow">Latest M3U</p>
              <h2>{latestExport.outputPath}</h2>
              <p>
                {latestExport.writtenTracks} exported ·{" "}
                {latestExport.missingTracks} missing
              </p>
            </div>
            <span className="status ok">Ready</span>
          </div>
        )}
      {stage !== "lidarr" && revisions.length > 0 && (
        <details className="history">
          <summary>Playlist refresh history ({revisions.length})</summary>
          {revisions.map((revision) => (
            <p key={revision.id}>
              <Link href={`/imports/${id}/revisions/${revision.id}`}>
                {revision.created_at.slice(0, 16).replace("T", " ")}
              </Link>{" "}
              · {revision.added} added · {revision.updated} updated ·{" "}
              {revision.removed} removed · {revision.moved} moved
            </p>
          ))}
        </details>
      )}
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
              matchedTitle: musicMatchRecordings.get(entry.id)?.title,
              matchedArtists: musicMatchRecordings.get(entry.id)?.artists,
            }))}
          />
        </section>
      )}
      {stage === "lidarr" && planHeader && (
        <section id="lidarr-plan">
          <section className="dashboard-stats">
            <div>
              <strong>{planSummary.artists}</strong>
              <span>Artists represented · {planSummary.newArtists} new</span>
            </div>
            <div>
              <strong>{planSummary.releases}</strong>
              <span>
                Requested releases · {planSummary.represented} represented
              </span>
            </div>
            <div>
              <strong>{planSummary.monitored}</strong>
              <span>Will be monitored</span>
            </div>
            <div>
              <strong>{planSummary.searches}</strong>
              <span>
                Searches queued · {planSummary.attention} need attention
              </span>
            </div>
          </section>
          <p>
            Planning is read-only. Approval authorizes exactly these actions;
            execution revalidates Lidarr immediately before mutation.
          </p>
          <LidarrPlanTable
            rows={planRows}
            planId={planHeader.id}
            planStatus={planHeader.status}
            csrf={csrf}
            retryAction={retryLidarrPlanEntry}
            allowVariousArtistsAction={allowVariousArtistsRelease}
            changeReleaseAction={changeLidarrPlanRelease}
          />
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
          <FinalTrackTable rows={finalRows} />
        </section>
      )}
    </>
  );
}

function ImportWorkflowSkeleton() {
  return (
    <section className="card skeleton">Loading playlist workflow…</section>
  );
}
