import { connection } from "next/server";
import { notFound } from "next/navigation";
import {
  acceptManualMapping,
  clearManualOverride,
  retryAutomaticResolution,
  reuseManualMapping,
  searchManualCandidates,
  skipReviewEntry,
  validateManualMbid,
} from "../../../../actions/manual-review";
import {
  validationWarnings,
  type Candidate,
  type CandidateRelease,
} from "../../../../../server/integrations/musicbrainz/candidates";
import { ResolutionRepository } from "../../../../../server/persistence/resolution-repository";
import { database } from "../../../../../server/runtime";
import { requestCsrfToken } from "../../../../../server/security/request";

interface ReviewQuery {
  error?: string;
  q?: string;
  session?: string;
  plan_id?: string;
  validation?: string;
  method?: string;
  mbid?: string;
}

function HiddenContext({
  entryId,
  csrf,
  query,
}: {
  entryId: number;
  csrf: string;
  query: ReviewQuery;
}) {
  return (
    <>
      <input type="hidden" name="csrf_token" value={csrf} />
      <input type="hidden" name="entry_id" value={entryId} />
      {query.session === "true" && (
        <input type="hidden" name="session" value="true" />
      )}
      {query.plan_id && (
        <input type="hidden" name="plan_id" value={query.plan_id} />
      )}
    </>
  );
}

function releaseLabel(release: CandidateRelease): string {
  return [
    release.releaseGroupTitle || release.title,
    release.primaryType || "Release",
    release.date || "Unknown date",
  ].join(" · ");
}

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<ReviewQuery>;
}) {
  await connection();
  const entryId = Number((await params).id);
  const repository = new ResolutionRepository(database);
  let entry;
  try {
    entry = repository.reviewEntry(entryId);
  } catch {
    notFound();
  }
  const query = await searchParams;
  const session = query.session === "true";
  const queue = repository.reviewQueue(entry.importId);
  const sessionIndex = Math.max(
    0,
    queue.findIndex((item) => item.id === entryId),
  );
  const previous = sessionIndex > 0 ? queue[sessionIndex - 1] : undefined;
  const next =
    sessionIndex + 1 < queue.length ? queue[sessionIndex + 1] : undefined;
  const candidates =
    query.q !== undefined || query.validation !== undefined
      ? (repository.candidates(entryId) as Candidate[])
      : [];
  const validationIndex = Number(query.validation);
  const validation = Number.isInteger(validationIndex)
    ? candidates[validationIndex]
    : undefined;
  const warnings = validation ? validationWarnings(validation) : [];
  const suggestions = repository.manualMatchSuggestions(entryId);
  const csrf = await requestCsrfToken();
  const context = { entryId, csrf, query };

  return (
    <main>
      {query.plan_id && (
        <div className="next-step">
          <strong>Editing the final Lidarr binding.</strong>
          <span>
            Saving queues this change without rebuilding the plan. Make the rest
            of your changes, then rebuild once.
          </span>
        </div>
      )}
      <p className="eyebrow">Manual resolution</p>
      <nav className="steps" aria-label="Workflow progress">
        <strong aria-current="step">1 Music match</strong>
        <a href={`/imports/${entry.importId}?stage=lidarr`}>2 Lidarr</a>
        <a href={`/imports/${entry.importId}?stage=final`}>3 Final</a>
      </nav>
      {session && (
        <div className="session-bar">
          <div>
            <strong>Matching session</strong>
            <small>
              Track {sessionIndex + 1} of {queue.length}
            </small>
          </div>
          <div>
            {previous && (
              <a
                className="button secondary"
                href={`/entries/${previous.id}/review?session=true`}
              >
                Previous
              </a>
            )}
            {next && (
              <a
                className="button secondary"
                href={`/entries/${next.id}/review?session=true`}
              >
                Next
              </a>
            )}
            <a href={`/imports/${entry.importId}`}>Exit session</a>
          </div>
        </div>
      )}
      <h1>{entry.track.title}</h1>
      <div className="source-summary">
        <strong>{entry.track.artists.join(", ")}</strong>
        <p>
          {entry.track.album || "No album"}
          {entry.track.durationMs
            ? ` · ${(entry.track.durationMs / 1000).toFixed(1)} sec`
            : ""}
          {entry.track.isrc ? ` · ${entry.track.isrc}` : ""}
        </p>
        <p>
          Automatic result: {entry.resolution.state.replaceAll("_", " ")}
          {entry.resolution.result.failureReason
            ? ` — ${entry.resolution.result.failureReason}`
            : ""}
        </p>
      </div>
      {query.error && (
        <p className="alert">{query.error.replaceAll("_", " ")}</p>
      )}

      {suggestions.length > 0 && (
        <section className="card match-suggestions">
          <p className="eyebrow">Previously matched</p>
          <h2>Reuse a manual match</h2>
          {suggestions.map((suggestion) => (
            <div className="reuse-match" key={suggestion.entryId}>
              <div>
                <strong>
                  {suggestion.result.artistNames?.join(", ")} —{" "}
                  {suggestion.result.recordingTitle}
                </strong>
                <small>
                  Manually matched in {suggestion.playlistName} ·{" "}
                  {suggestion.result.recordingIds?.join(", ")}
                </small>
              </div>
              <form action={reuseManualMapping}>
                <HiddenContext {...context} />
                <input
                  type="hidden"
                  name="source_entry_id"
                  value={suggestion.entryId}
                />
                <button>Apply match</button>
              </form>
            </div>
          ))}
        </section>
      )}

      <div className="review-actions">
        <form action={searchManualCandidates}>
          <HiddenContext {...context} />
          <label>
            Search MusicBrainz
            <input
              name="query"
              defaultValue={query.q ?? ""}
              placeholder="Track title or search terms"
            />
          </label>
          <button>Search</button>
        </form>
        <form action={validateManualMbid}>
          <HiddenContext {...context} />
          <input type="hidden" name="method" value="manual_mbid" />
          <label>
            Recording MBID
            <input
              name="mbid"
              defaultValue={query.mbid ?? ""}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              required
            />
          </label>
          <button>Validate MBID</button>
        </form>
      </div>

      {validation && (
        <section className="card validation">
          <h2>Validation: {warnings.length ? "warning" : "valid"}</h2>
          <h3>
            {validation.result.artistNames?.join(", ")} —{" "}
            {validation.result.recordingTitle}
          </h3>
          <dl>
            <dt>Artist match</dt>
            <dd>{String(validation.evidence.artistMatch)}</dd>
            <dt>Title similarity</dt>
            <dd>{validation.evidence.titleSimilarity}</dd>
            <dt>Duration delta</dt>
            <dd>{validation.evidence.durationDeltaMs ?? "Unknown"} ms</dd>
            <dt>ISRC match</dt>
            <dd>{String(validation.evidence.isrcMatch)}</dd>
            <dt>Release group</dt>
            <dd>
              {validation.result.releaseGroupIds?.join(", ") || "Missing"}
            </dd>
          </dl>
          {warnings.map((warning) => (
            <p className="warning" key={warning}>
              ⚠ {warning.replaceAll("_", " ")}
            </p>
          ))}
          <form action={acceptManualMapping}>
            <HiddenContext {...context} />
            <input type="hidden" name="mbid" value={query.mbid ?? ""} />
            <input
              type="hidden"
              name="method"
              value={
                query.method === "manual_search"
                  ? "manual_search"
                  : "manual_mbid"
              }
            />
            {(validation.result.releaseGroupIds?.length ?? 0) > 1 && (
              <label>
                Choose release group
                <select name="release_group_id" required defaultValue="">
                  <option value="">Select…</option>
                  {validation.result.releaseGroupIds?.map((group) => {
                    const release = validation.releases.find(
                      (item) => item.releaseGroupId === group,
                    );
                    return (
                      <option value={group} key={group}>
                        {release ? releaseLabel(release) : group}
                      </option>
                    );
                  })}
                </select>
              </label>
            )}
            {warnings.length > 0 && (
              <label>
                <input
                  className="checkbox"
                  type="checkbox"
                  name="allow_warning"
                  value="true"
                  required
                />
                I understand and accept these differences
              </label>
            )}
            <button>Accept validated mapping</button>
          </form>
        </section>
      )}

      {query.q !== undefined && candidates.length > 0 && !validation && (
        <>
          <h2>Candidates</h2>
          <div className="candidate-list">
            {candidates.map((candidate, index) => (
              <article
                className="card"
                key={`${candidate.result.recordingIds?.[0]}-${index}`}
              >
                <div>
                  <span className="score">{Math.round(candidate.score)}</span>
                  <h3>
                    {candidate.result.artistNames?.join(", ")} —{" "}
                    {candidate.result.recordingTitle}
                  </h3>
                  <p>MBID {candidate.result.recordingIds?.[0]}</p>
                  <p>
                    Title similarity {candidate.evidence.titleSimilarity} ·
                    Artist{" "}
                    {candidate.evidence.artistMatch ? "match" : "differs"} ·
                    ISRC{" "}
                    {candidate.evidence.isrcMatch ? "match" : "not matched"}
                  </p>
                  {candidate.releases.slice(0, 4).map((release) => (
                    <small key={`${release.id}-${release.releaseGroupId}`}>
                      {releaseLabel(release)}
                    </small>
                  ))}
                </div>
                <form action={validateManualMbid}>
                  <HiddenContext {...context} />
                  <input type="hidden" name="method" value="manual_search" />
                  <input
                    type="hidden"
                    name="mbid"
                    value={candidate.result.recordingIds?.[0]}
                  />
                  <button>Validate</button>
                </form>
              </article>
            ))}
          </div>
        </>
      )}

      <div className="danger-zone">
        {entry.resolution.isManual ? (
          <form action={clearManualOverride}>
            <HiddenContext {...context} />
            <button className="secondary">Clear manual override</button>
          </form>
        ) : (
          !session && (
            <form action={retryAutomaticResolution}>
              <HiddenContext {...context} />
              <button className="secondary">Retry automatic resolution</button>
            </form>
          )
        )}
        <form action={skipReviewEntry}>
          <HiddenContext {...context} />
          <button className="secondary">
            Skip track{session ? " and continue" : ""}
          </button>
        </form>
      </div>
    </main>
  );
}
