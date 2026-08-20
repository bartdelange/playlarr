"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  allowVariousArtistsRelease as allowVariousArtistsReleaseForPlan,
  changePlannedRelease,
  preparePlanEntryRetry,
} from "../../server/application/lidarr-plan-actions";
import { ImportRepository } from "../../server/persistence/import-repository";
import { JobRepository } from "../../server/persistence/job-repository";
import { LidarrPlanRepository } from "../../server/persistence/lidarr-plan-repository";
import { MappingOverridesRepository } from "../../server/persistence/mapping-overrides-repository";
import { resetSpotify, spotify, tidal } from "../../server/providers";
import { importMappingCsv } from "../../server/application/mapping-csv-import";
import { ResolutionRepository } from "../../server/persistence/resolution-repository";
import { database, settings } from "../../server/runtime";
import { requireCsrf } from "./security";
const jobs = () => new JobRepository(database);
const imports = () => new ImportRepository(database);
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
  if (service === "spotify") resetSpotify();
  revalidatePath("/settings");
  redirect(
    `/settings?message=${encodeURIComponent(`${service} settings saved`)}`,
  );
}
export async function authenticateSpotify(form: FormData) {
  await requireCsrf(form);
  redirect(await spotify().auth.authorizationUrl());
}
export async function authenticateTidal(form: FormData) {
  await requireCsrf(form);
  const authorization = await tidal().auth.beginDeviceAuthorization();
  redirect(
    `/settings/tidal-auth?${new URLSearchParams({
      verification_url: authorization.verificationUrl,
      user_code: authorization.userCode,
    })}`,
  );
}
export async function queuePlaylistAcquisition(form: FormData) {
  await requireCsrf(form);
  const source = String(form.get("source"));
  const reference = String(form.get("reference") ?? "").trim();
  if (!reference || !["spotify", "tidal"].includes(source))
    redirect("/imports/new?error=Choose%20a%20provider%20and%20playlist");
  const existing = imports().findImport(source, reference);
  if (existing) redirect(`/imports/${existing.id}`);
  const imported = imports().createImport({
    source,
    id: reference,
    name: "Loading playlist…",
  });
  redirect(
    `/jobs/${jobs().create("playlist_acquisition", imported.id, 2, { source, reference }).id}`,
  );
}
export async function queuePlaylistAnalysis(form: FormData) {
  await requireCsrf(form);
  const source = String(form.get("source"));
  const reference = String(form.get("reference"));
  if (!reference || !["spotify", "tidal"].includes(source))
    throw new Error("Choose a playlist to analyze");
  redirect(
    `/jobs/${jobs().create("playlist_analysis", undefined, 0, { source, reference }).id}`,
  );
}
export async function importMappingCsvAction(form: FormData) {
  await requireCsrf(form);
  const file = form.get("mapping");
  if (!(file instanceof File) || !file.size)
    throw new Error("Choose a mapping CSV");
  const imported = importMappingCsv(
    await file.text(),
    file.name.replace(/\.[^.]+$/, "") || "Imported playlist",
    imports(),
    new ResolutionRepository(database),
  );
  redirect(`/imports/${imported.id}`);
}
export async function queuePlaylistCatalogue(form: FormData) {
  await requireCsrf(form);
  const source = String(form.get("source"));
  if (!["spotify", "tidal"].includes(source))
    redirect("/imports/new?error=Choose%20a%20playlist%20source");
  redirect(
    `/jobs/${jobs().create("playlist_catalogue", undefined, 0, { source }).id}`,
  );
}
export async function queueResolution(form: FormData) {
  await requireCsrf(form);
  const importId = String(form.get("import_id"));
  redirect(
    `/jobs/${jobs().create("resolution", importId, imports().entries(importId).length).id}`,
  );
}
export async function queueLidarrPlan(form: FormData) {
  await requireCsrf(form);
  const importId = String(form.get("import_id"));
  redirect(`/jobs/${jobs().create("lidarr_planning", importId, 3).id}`);
}
export async function retryLidarrPlanEntry(form: FormData) {
  await requireCsrf(form);
  const planId = String(form.get("plan_id"));
  const entryId = Number(form.get("entry_id"));
  const importId = preparePlanEntryRetry(database, planId, entryId);
  redirect(
    `/jobs/${jobs().create("resolution_retry", importId, 1, { entryId }).id}`,
  );
}
export async function allowVariousArtistsRelease(form: FormData) {
  await requireCsrf(form);
  const planId = String(form.get("plan_id"));
  const importId = allowVariousArtistsReleaseForPlan(
    database,
    planId,
    Number(form.get("entry_id")),
  );
  revalidatePath(`/imports/${importId}`);
  redirect(`/imports/${importId}?stage=lidarr`);
}
export async function changeLidarrPlanRelease(form: FormData) {
  await requireCsrf(form);
  const planId = String(form.get("plan_id"));
  const importId = changePlannedRelease(
    database,
    planId,
    Number(form.get("entry_id")),
    String(form.get("release_group_id")),
  );
  revalidatePath(`/imports/${importId}`);
  redirect(`/imports/${importId}?stage=lidarr`);
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
