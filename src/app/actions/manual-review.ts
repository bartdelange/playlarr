"use server";

import { redirect } from "next/navigation";
import {
  confirmManualResolution,
  type ManualResolutionMethod,
  prepareAutomaticRetry,
  reusePreviousResolution,
  reviewDecisionDestination,
} from "../../server/application/manual-review";
import { MusicBrainzClient } from "../../server/integrations/musicbrainz/client";
import { ManualMusicBrainzMatcher } from "../../server/integrations/musicbrainz/manual-matching";
import { JobRepository } from "../../server/persistence/job-repository";
import { ResolutionRepository } from "../../server/persistence/resolution-repository";
import { config, database, settings } from "../../server/runtime";
import { requireCsrf } from "./security";

const resolutions = () => new ResolutionRepository(database);
const matcher = () =>
  new ManualMusicBrainzMatcher(
    new MusicBrainzClient({
      baseUrl: config.musicBrainz.baseUrl,
      userAgent: settings.get("mb_user_agent", config.musicBrainz.userAgent),
      requestDelayMs: config.musicBrainz.requestDelay * 1000,
      timeoutMs: config.musicBrainz.timeout * 1000,
      maxRetries: config.musicBrainz.maxRetries,
    }),
  );

function context(form: FormData) {
  return {
    session: form.get("session") === "true",
    planId: String(form.get("plan_id") ?? "") || undefined,
  };
}

function reviewUrl(entryId: number, values: Record<string, string | undefined> = {}): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value) query.set(key, value);
  return `/entries/${entryId}/review${query.size ? `?${query}` : ""}`;
}

function reviewContext(values: ReturnType<typeof context>) {
  return {
    session: values.session ? "true" : undefined,
    plan_id: values.planId,
  };
}

export async function searchManualCandidates(form: FormData) {
  await requireCsrf(form);
  const entryId = Number(form.get("entry_id"));
  const query = String(form.get("query") ?? "").trim();
  const repository = resolutions();
  const candidates = await matcher().search(repository.reviewEntry(entryId).track, query || undefined);
  repository.saveCandidates(entryId, candidates);
  redirect(
    reviewUrl(entryId, {
      ...reviewContext(context(form)),
      q: query || repository.reviewEntry(entryId).track.title,
    }),
  );
}

export async function validateManualMbid(form: FormData) {
  await requireCsrf(form);
  const entryId = Number(form.get("entry_id"));
  const mbid = String(form.get("mbid") ?? "").trim();
  const method = form.get("method") === "manual_search" ? "manual_search" : "manual_mbid";
  const repository = resolutions();
  const validation = await matcher().validateRecordingMbid(mbid, repository.reviewEntry(entryId).track);
  const values = context(form);
  if (validation.status === "invalid" || !validation.candidate) {
    repository.markValidationFailed(entryId, validation.errors);
    redirect(
      reviewUrl(entryId, {
        ...reviewContext(values),
        error: validation.errors.join(", "),
        mbid,
      }),
    );
  }
  repository.saveCandidates(entryId, [validation.candidate]);
  redirect(
    reviewUrl(entryId, {
      ...reviewContext(values),
      validation: "0",
      method,
      mbid,
    }),
  );
}

export async function acceptManualMapping(form: FormData) {
  await requireCsrf(form);
  const entryId = Number(form.get("entry_id"));
  const mbid = String(form.get("mbid") ?? "");
  const method = String(form.get("method") ?? "");
  if (!new Set(["manual_search", "manual_mbid"]).has(method)) throw new Error("invalid manual resolution method");
  const repository = resolutions();
  const validation = await matcher().validateRecordingMbid(mbid, repository.reviewEntry(entryId).track);
  const selected = String(form.get("release_group_id") ?? "") || undefined;
  confirmManualResolution(
    repository,
    entryId,
    validation,
    method as ManualResolutionMethod,
    form.get("allow_warning") === "true",
    selected,
  );
  const values = context(form);
  redirect(reviewDecisionDestination(repository, entryId, values.session, values.planId));
}

export async function reuseManualMapping(form: FormData) {
  await requireCsrf(form);
  const entryId = Number(form.get("entry_id"));
  const sourceEntryId = Number(form.get("source_entry_id"));
  const repository = resolutions();
  reusePreviousResolution(repository, entryId, sourceEntryId);
  const values = context(form);
  redirect(reviewDecisionDestination(repository, entryId, values.session, values.planId));
}

export async function skipReviewEntry(form: FormData) {
  await requireCsrf(form);
  const entryId = Number(form.get("entry_id"));
  const repository = resolutions();
  repository.markSkipped(entryId);
  repository.updateReviewWorkflow(repository.reviewEntry(entryId).importId);
  const values = context(form);
  redirect(reviewDecisionDestination(repository, entryId, values.session, values.planId));
}

export async function clearManualOverride(form: FormData) {
  await requireCsrf(form);
  const entryId = Number(form.get("entry_id"));
  const repository = resolutions();
  const importId = repository.reviewEntry(entryId).importId;
  repository.clearManual(entryId);
  repository.requireReview(importId);
  redirect(`/imports/${importId}`);
}

export async function retryAutomaticResolution(form: FormData) {
  await requireCsrf(form);
  const entryId = Number(form.get("entry_id"));
  const repository = resolutions();
  const values = context(form);
  const job = prepareAutomaticRetry(repository, new JobRepository(database), entryId, values.planId);
  redirect(`/jobs/${job.id}`);
}
