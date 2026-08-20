import { connection } from "next/server";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { ResolutionRepository } from "../../../../../server/persistence/resolution-repository";
import { database } from "../../../../../server/runtime";

export default function StartReviewSession({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense
      fallback={
        <main>
          <p>Opening manual review…</p>
        </main>
      }
    >
      <ReviewSessionRedirect params={params} />
    </Suspense>
  );
}

async function ReviewSessionRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();
  const importId = (await params).id;
  if (!database.prepare("SELECT 1 FROM imports WHERE id = ?").get(importId))
    notFound();
  const first = new ResolutionRepository(database).reviewQueue(importId)[0];
  return redirect(
    first ? `/entries/${first.id}/review?session=true` : `/imports/${importId}`,
  );
}
