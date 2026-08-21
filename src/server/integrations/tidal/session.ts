import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export interface TidalSession {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tokenType?: string;
  scope?: string;
}
export interface TidalPendingAuthorization {
  deviceCode: string;
  intervalMs: number;
  nextPollAt: number;
  expiresAt: number;
  status: "pending" | "failed";
  error?: string;
}
export interface TidalSessionStore {
  load(): Promise<TidalSession | undefined>;
  save(session: TidalSession): Promise<void>;
  loadPending(): Promise<TidalPendingAuthorization | undefined>;
  savePending(pending: TidalPendingAuthorization): Promise<void>;
  clearPending(): Promise<void>;
}

export class FileTidalSessionStore implements TidalSessionStore {
  constructor(private readonly sessionPath: string) {}
  async load(): Promise<TidalSession | undefined> {
    try {
      const value = JSON.parse(await readFile(this.sessionPath, "utf8")) as
        TidalSession | Record<string, { data?: unknown }>;
      if ("accessToken" in value) return value as TidalSession;
      const accessToken = nestedString(value, "access_token");
      if (!accessToken) return undefined;
      return {
        accessToken,
        refreshToken: nestedString(value, "refresh_token"),
        tokenType: nestedString(value, "token_type"),
        expiresAt: 0,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
  async save(session: TidalSession): Promise<void> {
    await this.writePrivateJson(this.sessionPath, session);
  }
  async loadPending(): Promise<TidalPendingAuthorization | undefined> {
    try {
      return JSON.parse(await readFile(this.pendingPath, "utf8")) as TidalPendingAuthorization;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
  async savePending(pending: TidalPendingAuthorization): Promise<void> {
    await this.writePrivateJson(this.pendingPath, pending);
  }
  async clearPending(): Promise<void> {
    try {
      await unlink(this.pendingPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  private get pendingPath(): string {
    return `${this.sessionPath}.pending`;
  }
  private async writePrivateJson(destination: string, value: TidalSession | TidalPendingAuthorization): Promise<void> {
    await mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.tmp`;
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await rename(temporary, destination);
  }
}

function nestedString(value: Record<string, { data?: unknown }>, key: string): string | undefined {
  const item = value[key]?.data;
  return typeof item === "string" && item ? item : undefined;
}
