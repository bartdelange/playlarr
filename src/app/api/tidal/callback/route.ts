import { NextResponse } from "next/server";
import { tidal } from "../../../../server/providers";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state)
    return new NextResponse("TIDAL callback is missing code or state", {
      status: 400,
    });
  try {
    await tidal().auth.complete(code, state);
    return NextResponse.redirect(
      new URL("/settings?message=TIDAL%20authenticated", request.url),
    );
  } catch (error) {
    return new NextResponse(
      error instanceof Error ? error.message : "TIDAL authentication failed",
      { status: 400 },
    );
  }
}
