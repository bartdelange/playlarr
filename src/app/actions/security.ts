"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { security } from "../../server/runtime";
import { sessionCookie, sessionLifetimeSeconds } from "../../server/security/web-security";
import { secureSessionCookie } from "../../server/security/cookie-security";

const passwordError = (password: string, confirmation: string) =>
  password.length < 12
    ? "Password must be at least 12 characters"
    : password !== confirmation
      ? "Passwords do not match"
      : undefined;
async function setSession(token: string) {
  const requestHeaders = await headers();
  (await cookies()).set(sessionCookie, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureSessionCookie(requestHeaders),
    maxAge: sessionLifetimeSeconds,
    path: "/",
  });
}
export async function requireCsrf(form: FormData) {
  const jar = await cookies();
  const session = jar.get(sessionCookie)?.value ?? "";
  const requestHeaders = await headers();
  if (
    !security.sameOrigin("http://playlarr.invalid", requestHeaders.get("origin"), requestHeaders.get("host")) ||
    !security.validSession(session) ||
    !security.validCsrf(session, String(form.get("csrf_token") ?? ""))
  )
    throw new Error("Invalid CSRF token");
}
export async function setup(form: FormData) {
  if (security.configured) redirect("/login");
  const password = String(form.get("password") ?? "");
  const error = passwordError(password, String(form.get("confirm_password") ?? ""));
  if (error) redirect(`/setup?error=${encodeURIComponent(error)}`);
  await security.setPassword(password);
  await setSession(security.createSession());
  redirect("/");
}
export async function skipSetup() {
  if (!security.configured) security.disableAuthorization();
  await setSession(security.createSession());
  redirect("/");
}
export async function login(form: FormData) {
  if (!security.configured) redirect("/setup");
  const requestHeaders = await headers();
  const client = requestHeaders.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  if (!security.allowLogin(client)) redirect("/login?error=Too%20many%20login%20attempts%3B%20try%20again%20later");
  if (!(await security.verifyPassword(String(form.get("password") ?? "")))) {
    security.recordFailedLogin(client);
    redirect("/login?error=Invalid%20password");
  }
  security.clearFailedLogins(client);
  await setSession(security.createSession());
  redirect("/");
}
export async function logout(form: FormData) {
  await requireCsrf(form);
  (await cookies()).delete(sessionCookie);
  redirect("/login");
}
export async function changePassword(form: FormData) {
  await requireCsrf(form);
  if (!(await security.verifyPassword(String(form.get("current_password") ?? ""))))
    redirect("/settings?error=Current%20password%20is%20incorrect");
  const password = String(form.get("password") ?? "");
  const error = passwordError(password, String(form.get("confirm_password") ?? ""));
  if (error) redirect(`/settings?error=${encodeURIComponent(error)}`);
  await security.setPassword(password);
  security.rotateSessions();
  (await cookies()).delete(sessionCookie);
  redirect("/login");
}
export async function changeAuthorization(form: FormData) {
  await requireCsrf(form);
  if (form.get("authorization_enabled") !== "true") {
    security.disableAuthorization();
    await setSession(security.createSession());
    redirect("/settings?message=Authorization%20disabled");
  }
  if (!security.hasPassword) {
    const password = String(form.get("password") ?? "");
    const error = passwordError(password, String(form.get("confirm_password") ?? ""));
    if (error) redirect(`/settings?error=${encodeURIComponent(error)}`);
    await security.setPassword(password);
  } else security.enableAuthorization();
  (await cookies()).delete(sessionCookie);
  redirect("/login");
}
