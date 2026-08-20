import { NextResponse } from "next/server";
import { spotify } from "../../server/providers";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state)
    return new NextResponse("Spotify callback is missing code or state", {
      status: 400,
    });
  try {
    await spotify().auth.complete(code, state);
    return NextResponse.redirect(
      new URL("/settings?message=Spotify%20authenticated", request.url),
    );
  } catch (error) {
    return new NextResponse(
      error instanceof Error ? error.message : "Spotify authentication failed",
      { status: 400 },
    );
  }
}
