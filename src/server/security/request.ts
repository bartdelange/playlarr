import { cookies } from "next/headers";
import { security } from "../runtime";
import { sessionCookie } from "./web-security";
export async function requestCsrfToken(): Promise<string> {
  const session = (await cookies()).get(sessionCookie)?.value;
  if (!session || !security.validSession(session)) return "";
  return security.csrfToken(session);
}
