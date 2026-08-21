import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

export const sessionCookie = "playlarr_session";
export const sessionLifetimeSeconds = 30 * 24 * 60 * 60;
export interface SecuritySettings {
  get<T>(key: string, fallback: T): T;
  set(key: string, value: unknown): void;
}
export class WebSecurity {
  private attempts = new Map<string, number[]>();
  constructor(
    private readonly settings: SecuritySettings,
    private readonly wallClock = () => Date.now(),
    private readonly monotonicClock = () => performance.now(),
  ) {}
  get mode(): "password" | "disabled" | undefined {
    const mode = this.settings.get<string | undefined>("web_auth_mode", undefined);
    if (mode === "password" || mode === "disabled") return mode;
    return this.hasPassword ? "password" : undefined;
  }
  get configured() {
    return this.mode !== undefined;
  }
  get authorizationEnabled() {
    return this.mode === "password";
  }
  get hasPassword() {
    return Boolean(this.settings.get("web_auth_password_hash", ""));
  }
  async setPassword(password: string) {
    this.settings.set("web_auth_password_hash", await hash(password));
    this.settings.set("web_auth_mode", "password");
  }
  async verifyPassword(password: string): Promise<boolean> {
    const encoded = this.settings.get("web_auth_password_hash", "");
    if (typeof encoded !== "string" || !encoded) return false;
    try {
      return await verify(encoded, password);
    } catch {
      return false;
    }
  }
  disableAuthorization() {
    this.settings.set("web_auth_mode", "disabled");
    this.rotateSessions();
  }
  enableAuthorization() {
    if (!this.hasPassword) throw new Error("create a password before enabling authorization");
    this.settings.set("web_auth_mode", "password");
    this.rotateSessions();
  }
  rotateSessions() {
    this.settings.set("web_auth_session_secret", randomBytes(48).toString("base64url"));
  }
  createSession(): string {
    const payload = `${Math.floor(this.wallClock() / 1000) + sessionLifetimeSeconds}.${randomBytes(24).toString("base64url")}`;
    return `${payload}.${this.sign(payload)}`;
  }
  validSession(token?: string): boolean {
    if (!token) return false;
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const payload = `${parts[0]}.${parts[1]}`;
    return Number(parts[0]) > this.wallClock() / 1000 && safeEqual(parts[2], this.sign(payload));
  }
  csrfToken(session: string): string {
    return this.sign(`csrf.${session}`);
  }
  validCsrf(session: string, supplied?: string): boolean {
    return Boolean(supplied && safeEqual(supplied, this.csrfToken(session)));
  }
  sameOrigin(requestUrl: string, origin?: string | null, host?: string | null): boolean {
    if (!origin) return true;
    try {
      const parsed = new URL(origin);
      const expected = host ?? new URL(requestUrl).host;
      return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.host === expected;
    } catch {
      return false;
    }
  }
  allowLogin(client: string): boolean {
    this.prune(client);
    return (this.attempts.get(client)?.length ?? 0) < 5;
  }
  recordFailedLogin(client: string) {
    const attempts = this.attempts.get(client) ?? [];
    attempts.push(this.monotonicClock());
    this.attempts.set(client, attempts);
  }
  clearFailedLogins(client: string) {
    this.attempts.delete(client);
  }
  private prune(client: string) {
    const cutoff = this.monotonicClock() - 5 * 60 * 1000;
    this.attempts.set(
      client,
      (this.attempts.get(client) ?? []).filter((attempt) => attempt > cutoff),
    );
  }
  private secret(): string {
    let secret = this.settings.get("web_auth_session_secret", "");
    if (typeof secret !== "string" || !secret) {
      secret = randomBytes(48).toString("base64url");
      this.settings.set("web_auth_session_secret", secret);
    }
    return secret;
  }
  private sign(value: string): string {
    return createHmac("sha256", this.secret()).update(value).digest("hex");
  }
}
function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
