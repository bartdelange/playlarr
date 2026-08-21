import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { tidal } from "../../../../../server/providers";
import { security } from "../../../../../server/runtime";
import { sessionCookie } from "../../../../../server/security/web-security";

export async function GET() {
  const session = (await cookies()).get(sessionCookie)?.value;
  if (!security.validSession(session)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await tidal().auth.authorizationStatus());
}
