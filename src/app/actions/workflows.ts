"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SourceTrack } from "../../server/domain/playlist";
import { MusicBrainzClient } from "../../server/integrations/musicbrainz/client";
import { ManualMusicBrainzMatcher } from "../../server/integrations/musicbrainz/manual-matching";
import type { Candidate } from "../../server/integrations/musicbrainz/candidates";
import { ImportRepository } from "../../server/persistence/import-repository";
import { JobRepository } from "../../server/persistence/job-repository";
import { LidarrPlanRepository } from "../../server/persistence/lidarr-plan-repository";
import { MappingOverridesRepository } from "../../server/persistence/mapping-overrides-repository";
import { ResolutionRepository } from "../../server/persistence/resolution-repository";
import { spotify, tidal } from "../../server/providers";
import { config, database, settings } from "../../server/runtime";
import { requireCsrf } from "./security";
const jobs = () => new JobRepository(database);
const imports = () => new ImportRepository(database);
const resolutions = () => new ResolutionRepository(database);
function entryTrack(entryId: number): SourceTrack {
  const row = database
    .prepare(
      "SELECT i.source, e.* FROM playlist_entries e JOIN imports i ON i.id = e.import_id WHERE e.id = ?",
    )
    .get(entryId) as Record<string, unknown> | undefined;
  if (!row) throw new Error(`unknown playlist entry: ${entryId}`);
  return {
    source: String(row.source),
    sourceTrackId: String(row.source_track_id),
    title: String(row.title),
    artists: JSON.parse(String(row.artists_json)) as string[],
    album: String(row.album),
    isrc: row.isrc ? String(row.isrc) : undefined,
    durationMs: row.duration_ms === null ? undefined : Number(row.duration_ms),
  };
}
function manualMatcher() {
  return new ManualMusicBrainzMatcher(
    new MusicBrainzClient({
      baseUrl: config.musicBrainz.baseUrl,
      userAgent: settings.get("mb_user_agent", config.musicBrainz.userAgent),
      requestDelayMs: config.musicBrainz.requestDelay * 1000,
      timeoutMs: config.musicBrainz.timeout * 1000,
      maxRetries: config.musicBrainz.maxRetries,
    }),
  );
}
export async function cancelJob(form: FormData) {
  await requireCsrf(form);
  jobs().requestCancel(String(form.get("job_id")));
  revalidatePath("/jobs");
}
export async function deleteImport(form: FormData) {
  await requireCsrf(form);
  imports().deleteImport(String(form.get("import_id")));
  revalidatePath("/");
  redirect("/");
}
export async function savePathMappings(form: FormData) {
  await requireCsrf(form);
  const source = String(form.get("lidarr_prefix") ?? "").trim();
  const target = String(form.get("consumer_prefix") ?? "").trim();
  settings.set("path_mappings", source && target ? [[source, target]] : []);
  revalidatePath("/settings");
  redirect("/settings?message=Playlist%20paths%20saved");
}
export async function saveServiceSettings(form: FormData) {
  await requireCsrf(form);
  const service = String(form.get("service"));
  const allowed: Record<string, string[]> = {
    musicbrainz: ["mb_user_agent"],
    spotify: ["spotify_client_id", "spotify_redirect_uri"],
    tidal: ["tidal_client_id", "tidal_redirect_uri"],
    lidarr: [
      "lidarr_url",
      "lidarr_api_key",
      "lidarr_root_folder",
      "lidarr_quality_profile_id",
      "lidarr_metadata_profile_id",
    ],
    navidrome: ["navidrome_url", "navidrome_username", "navidrome_password"],
  };
  for (const key of allowed[service] ?? []) {
    const value = String(form.get(key) ?? "").trim();
    if (value)
      settings.set(
        key,
        /^lidarr_(quality|metadata)_profile_id$/.test(key)
          ? Number(value)
          : value,
      );
  }
  revalidatePath("/settings");
  redirect(
    `/settings?message=${encodeURIComponent(`${service} settings saved`)}`,
  );
}
export async function authenticateSpotify(form: FormData) {
  await requireCsrf(form);
  redirect(spotify().auth.authorizationUrl());
}
export async function authenticateTidal(form: FormData) {
  await requireCsrf(form);
  redirect(tidal().auth.authorizationUrl());
}
export async function queuePlaylistAcquisition(form: FormData) {
  await requireCsrf(form);
  const source = String(form.get("source"));
  const reference = String(form.get("reference") ?? "").trim();
  if (!reference || !["spotify", "tidal"].includes(source))
    redirect("/imports/new?error=Choose%20a%20provider%20and%20playlist");
  redirect(
    `/jobs/${jobs().create("playlist_acquisition", undefined, 2, { source, reference }).id}`,
  );
}
export async function queueResolution(form: FormData) {
  await requireCsrf(form);
  const importId = String(form.get("import_id"));
  redirect(
    `/jobs/${jobs().create("resolution", importId, imports().entries(importId).length).id}`,
  );
}
export async function searchManualCandidates(form: FormData) {
  await requireCsrf(form);
  const entryId = Number(form.get("entry_id"));
  const candidates = await manualMatcher().search(
    entryTrack(entryId),
    String(form.get("query") ?? "") || undefined,
  );
  resolutions().saveCandidates(entryId, candidates);
  revalidatePath(`/entries/${entryId}/review`);
}
export async function validateManualMbid(form: FormData) {
  await requireCsrf(form);
  const entryId = Number(form.get("entry_id"));
  const validation = await manualMatcher().validateRecordingMbid(
    String(form.get("mbid") ?? ""),
    entryTrack(entryId),
  );
  if (!validation.candidate)
    redirect(
      `/entries/${entryId}/review?error=${encodeURIComponent(validation.errors.join(", "))}`,
    );
  resolutions().saveCandidates(entryId, [validation.candidate]);
  redirect(
    `/entries/${entryId}/review?message=${encodeURIComponent(validation.warnings.join(", ") || "Recording validated")}`,
  );
}
export async function confirmManualCandidate(form: FormData) {
  await requireCsrf(form);
  const entryId = Number(form.get("entry_id"));
  const candidate = resolutions().candidates(entryId)[
    Number(form.get("candidate_index") ?? 0)
  ] as Candidate | undefined;
  if (!candidate) throw new Error("candidate is unavailable");
  const group = String(
    form.get("release_group_id") ?? candidate.result.releaseGroupIds?.[0] ?? "",
  );
  resolutions().saveManual(
    entryId,
    candidate.result,
    "manual_search",
    candidate.evidence.artistMatch && candidate.evidence.titleSimilarity >= 0.55
      ? "valid"
      : "warning",
    candidate.evidence,
    group || undefined,
  );
  const owner = database
    .prepare("SELECT import_id FROM playlist_entries WHERE id = ?")
    .get(entryId) as { import_id: string };
  redirect(`/imports/${owner.import_id}`);
}
export async function queueLidarrPlan(form: FormData) {
  await requireCsrf(form);
  const importId = String(form.get("import_id"));
  redirect(`/jobs/${jobs().create("lidarr_planning", importId, 3).id}`);
}
export async function queuePlaylistUpdatePreview(form: FormData) {
  await requireCsrf(form);
  const importId = String(form.get("import_id"));
  imports().getImport(importId);
  redirect(`/jobs/${jobs().create("playlist_update_preview", importId, 2).id}`);
}
export async function applyPlaylistUpdate(form: FormData) {
  await requireCsrf(form);
  const importId = String(form.get("import_id"));
  const previewJob = String(form.get("preview_job"));
  const snapshotToken = String(form.get("snapshot_token"));
  redirect(
    `/jobs/${jobs().create("playlist_update", importId, 2, { previewJob, snapshotToken }).id}`,
  );
}
export async function applyMappingOverrides(form: FormData) {
  await requireCsrf(form);
  const importId = String(form.get("import_id"));
  const sourceImportId = String(form.get("source_import_id"));
  const targets = new Set(form.getAll("target_entry_ids").map(Number));
  new MappingOverridesRepository(database).apply(
    importId,
    sourceImportId,
    targets,
  );
  revalidatePath(`/imports/${importId}`);
  redirect(`/imports/${importId}`);
}
export async function approveAndExecutePlan(form: FormData) {
  await requireCsrf(form);
  const planId = String(form.get("plan_id"));
  const plans = new LidarrPlanRepository(database);
  plans.approve(planId);
  const plan = plans.get(planId);
  redirect(
    `/jobs/${jobs().create("lidarr_execution", plan.importId, plan.plan.actions.length, { planId }).id}`,
  );
}
