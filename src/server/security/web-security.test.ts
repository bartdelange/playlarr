import { expect, it } from "vitest";
import { WebSecurity } from "../../server/security/web-security";
const settings = () => {
  const values = new Map<string, unknown>();
  return {
    values,
    get<T>(key: string, fallback: T) {
      return values.has(key) ? (values.get(key) as T) : fallback;
    },
    set(key: string, value: unknown) {
      values.set(key, value);
    },
  };
};
it("stores compatible Argon2 hashes and rotates sessions on password changes", async () => {
  const store = settings();
  const security = new WebSecurity(store, () => 1000);
  await security.setPassword("long-test-password");
  expect(String(store.values.get("web_auth_password_hash"))).toMatch(
    /^\$argon2/,
  );
  expect(await security.verifyPassword("long-test-password")).toBe(true);
  const session = security.createSession();
  expect(security.validSession(session)).toBe(true);
  security.rotateSessions();
  expect(security.validSession(session)).toBe(false);
});
it("retains CSRF protection in gateway-managed mode", () => {
  const store = settings();
  const security = new WebSecurity(store);
  security.disableAuthorization();
  const session = security.createSession();
  expect(security.mode).toBe("disabled");
  expect(security.validCsrf(session, security.csrfToken(session))).toBe(true);
  expect(
    security.sameOrigin(
      "http://playlarr/settings",
      "https://attacker.invalid",
      "playlarr",
    ),
  ).toBe(false);
});
it("throttles five failed logins within five minutes and expires the window", () => {
  const store = settings();
  let clock = 0;
  const security = new WebSecurity(store, undefined, () => clock);
  for (let count = 0; count < 5; count++) security.recordFailedLogin("client");
  expect(security.allowLogin("client")).toBe(false);
  clock = 5 * 60 * 1000 + 1;
  expect(security.allowLogin("client")).toBe(true);
});
