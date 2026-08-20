"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ImportRepository } from "../../server/persistence/import-repository";
import { JobRepository } from "../../server/persistence/job-repository";
import { LocalAdditionsRepository } from "../../server/persistence/local-additions-repository";
import { database } from "../../server/runtime";
import { requireCsrf } from "./security";
export async function queueLibraryStatus(form: FormData) {
  await requireCsrf(form);
  const importId = String(form.get("import_id"));
  redirect(
    `/jobs/${new JobRepository(database).create("library_status", importId).id}`,
  );
}
export async function queuePlaylistGeneration(form: FormData) {
  await requireCsrf(form);
  const importId = String(form.get("import_id"));
  const imported = new ImportRepository(database).getImport(importId);
  if (
    !["library_status", "playlist_generated"].includes(imported.workflowState)
  )
    throw new Error("refresh download status before generating a playlist");
  redirect(
    `/jobs/${new JobRepository(database).create("playlist_generation", importId, 2).id}`,
  );
}
export async function addLocalTrack(form: FormData) {
  await requireCsrf(form);
  const importId = String(form.get("import_id"));
  new LocalAdditionsRepository(database).add(
    importId,
    {
      provider: "navidrome",
      providerTrackId: String(form.get("provider_track_id")),
      title: String(form.get("title")),
      artists: String(form.get("artist") ?? "")
        .split(";")
        .map((value) => value.trim())
        .filter(Boolean),
      album: String(form.get("album") ?? ""),
    },
    String(form.get("path") ?? ""),
  );
  revalidatePath(`/imports/${importId}/local-additions`);
}
export async function removeLocalTrack(form: FormData) {
  await requireCsrf(form);
  const importId = String(form.get("import_id"));
  new LocalAdditionsRepository(database).remove(
    importId,
    Number(form.get("addition_id")),
  );
  revalidatePath(`/imports/${importId}/local-additions`);
}
