import { NextResponse } from "next/server";
import { security } from "../../../../server/runtime";
import { sessionCookie, sessionLifetimeSeconds } from "../../../../server/security/web-security";
import { secureSessionCookie } from "../../../../server/security/cookie-security";

export function GET(request: Request) {
  if (!security.configured || security.authorizationEnabled)
    return NextResponse.redirect(new URL(security.configured ? "/login" : "/setup", request.url));
  const response = NextResponse.redirect(new URL("/", request.url));
  response.cookies.set(sessionCookie, security.createSession(), {
    httpOnly: true,
    sameSite: "lax",
    secure: secureSessionCookie(request.headers, request.url),
    maxAge: sessionLifetimeSeconds,
    path: "/",
  });
  return response;
}
