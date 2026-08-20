import { NextResponse } from "next/server";
import { database, security } from "../../../../server/runtime";
import { JobRepository } from "../../../../server/persistence/job-repository";
import { jobCompletionUrl } from "../../../../server/application/job-presentation";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = /(?:^|;\s*)playlarr_session=([^;]+)/.exec(
    request.headers.get("cookie") ?? "",
  )?.[1];
  if (!security.validSession(token))
    return new NextResponse("Unauthorized", { status: 401 });
  try {
    const job = new JobRepository(database).get((await params).id);
    return NextResponse.json(
      { ...job, completionUrl: jobCompletionUrl(job) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
