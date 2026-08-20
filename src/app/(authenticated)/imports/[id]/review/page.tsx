import { connection } from "next/server";
import { notFound, redirect } from "next/navigation";
import { ResolutionRepository } from "../../../../../server/persistence/resolution-repository";
import { database } from "../../../../../server/runtime";

export default async function StartReviewSession({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();
  const importId = (await params).id;
  if (!database.prepare("SELECT 1 FROM imports WHERE id = ?").get(importId))
    notFound();
  const first = new ResolutionRepository(database).reviewQueue(importId)[0];
  redirect(
    first ? `/entries/${first.id}/review?session=true` : `/imports/${importId}`,
  );
}
