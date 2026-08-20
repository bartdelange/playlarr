import { connection } from "next/server";
import { notFound } from "next/navigation";
import type { Candidate } from "../../../../../server/integrations/musicbrainz/candidates";
import { ResolutionRepository } from "../../../../../server/persistence/resolution-repository";
import { database } from "../../../../../server/runtime";
import { requestCsrfToken } from "../../../../../server/security/request";
import {
  confirmManualCandidate,
  searchManualCandidates,
  validateManualMbid,
} from "../../../../actions/workflows";
export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  await connection();
  const entryId = Number((await params).id);
  const row = database
    .prepare(
      "SELECT e.*, i.source FROM playlist_entries e JOIN imports i ON i.id = e.import_id WHERE e.id = ?",
    )
    .get(entryId) as Record<string, unknown> | undefined;
  if (!row) notFound();
  const repository = new ResolutionRepository(database);
  const resolution = repository.get(entryId);
  const candidates = repository.candidates(entryId) as Candidate[];
  const csrf = await requestCsrfToken();
  const query = await searchParams;
  return (
    <main>
      <p className="eyebrow">Manual review</p>
      <h1>{String(row.title)}</h1>
      <p>
        {(JSON.parse(String(row.artists_json)) as string[]).join(", ")} ·{" "}
        {String(row.album)}
      </p>
      {(query.error || query.message) && (
        <p role="alert">{query.error ?? query.message}</p>
      )}
      <section className="card">
        <h2>Current result</h2>
        <p>{resolution.result.recordingTitle || "Not matched"}</p>
        <small>
          {resolution.state.replaceAll("_", " ")}{" "}
          {resolution.method && `· ${resolution.method}`}
        </small>
      </section>
      <div className="card-list">
        <section className="card">
          <h2>Search MusicBrainz</h2>
          <form action={searchManualCandidates}>
            <input type="hidden" name="csrf_token" value={csrf} />
            <input type="hidden" name="entry_id" value={entryId} />
            <label>
              Search query
              <input name="query" defaultValue={String(row.title)} />
            </label>
            <button>Search candidates</button>
          </form>
        </section>
        <section className="card">
          <h2>Validate recording MBID</h2>
          <form action={validateManualMbid}>
            <input type="hidden" name="csrf_token" value={csrf} />
            <input type="hidden" name="entry_id" value={entryId} />
            <label>
              Recording MBID
              <input name="mbid" required />
            </label>
            <button>Validate MBID</button>
          </form>
        </section>
      </div>
      <section>
        <h2>Candidates</h2>
        {candidates.map((candidate, index) => (
          <article
            className="card"
            key={`${candidate.result.recordingIds?.[0]}-${index}`}
          >
            <strong>{candidate.result.recordingTitle}</strong>
            <small>{candidate.result.artistNames?.join(", ")}</small>
            <p>
              Title similarity{" "}
              {Math.round(candidate.evidence.titleSimilarity * 100)}% ·{" "}
              {candidate.evidence.artistMatch
                ? "artist matches"
                : "artist differs"}
              {candidate.evidence.isrcMatch && " · ISRC matches"}
            </p>
            <form action={confirmManualCandidate}>
              <input type="hidden" name="csrf_token" value={csrf} />
              <input type="hidden" name="entry_id" value={entryId} />
              <input type="hidden" name="candidate_index" value={index} />
              {(candidate.result.releaseGroupIds ?? []).length > 1 && (
                <label>
                  Release group
                  <select name="release_group_id">
                    {candidate.result.releaseGroupIds!.map((group) => (
                      <option key={group}>{group}</option>
                    ))}
                  </select>
                </label>
              )}
              <button>Confirm mapping</button>
            </form>
          </article>
        ))}
      </section>
    </main>
  );
}
