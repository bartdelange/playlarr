export function secureSessionCookie(requestHeaders: Pick<Headers, "get">, requestUrl?: string): boolean {
  const forwarded = requestHeaders.get("x-forwarded-proto")?.split(",", 1)[0].trim().toLowerCase();
  if (forwarded) return forwarded === "https";
  const origin = requestHeaders.get("origin");
  if (origin) {
    try {
      return new URL(origin).protocol === "https:";
    } catch {
      return false;
    }
  }
  return requestUrl ? new URL(requestUrl).protocol === "https:" : false;
}
