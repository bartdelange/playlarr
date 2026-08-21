"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ImportRepository } from "../../server/persistence/import-repository";
import { JobRepository } from "../../server/persistence/job-repository";
import { LocalAdditionsRepository } from "../../server/persistence/local-additions-repository";
import { NavidromeClient } from "../../server/integrations/navidrome/client";
import { addAuthoritativeLocalTrack } from "../../server/application/local-additions";
import { config, database, settings } from "../../server/runtime";
import { requireCsrf } from "./security";

export async function queueLibraryStatus(form: FormData) {
  await requireCsrf(form);
  const importId = String(form.get("import_id"));
  const imports = new ImportRepository(database);
  const imported = imports.getImport(importId);
  if (!["waiting_for_downloads", "library_status", "playlist_generated"].includes(imported.workflowState))
    throw new Error("apply a Lidarr plan before refreshing downloads");
  if (!imports.entries(importId).some((entry) => !["pending", "unresolved", "skipped"].includes(entry.resolutionState)))
    throw new Error("there are no resolved tracks to check");
  redirect(`/jobs/${new JobRepository(database).create("library_status", importId).id}`);
}
export async function queuePlaylistGeneration(form: FormData) {
  await requireCsrf(form);
  const importId = String(form.get("import_id"));
  const imported = new ImportRepository(database).getImport(importId);
  if (!["library_status", "playlist_generated"].includes(imported.workflowState))
    throw new Error("refresh download status before generating a playlist");
  redirect(`/jobs/${new JobRepository(database).create("playlist_generation", importId, 2).id}`);
}
export async function addLocalTrack(form: FormData) {
  await requireCsrf(form);
  const importId = String(form.get("import_id"));
  await addAuthoritativeLocalTrack(
    new LocalAdditionsRepository(database),
    new NavidromeClient({
      url: settings.get("navidrome_url", config.navidrome.url ?? ""),
      username: settings.get("navidrome_username", config.navidrome.username ?? ""),
      password: settings.get("navidrome_password", config.navidrome.password ?? ""),
    }),
    importId,
    String(form.get("song_id")),
  );
  revalidatePath(`/imports/${importId}/local-additions`);
}
export async function removeLocalTrack(form: FormData) {
  await requireCsrf(form);
  const importId = String(form.get("import_id"));
  new LocalAdditionsRepository(database).remove(importId, Number(form.get("addition_id")));
  revalidatePath(`/imports/${importId}/local-additions`);
}
