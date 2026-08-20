import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export interface TidalSession {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tokenType?: string;
  scope?: string;
}
export interface TidalSessionStore {
  load(): Promise<TidalSession | undefined>;
  save(session: TidalSession): Promise<void>;
}

export class FileTidalSessionStore implements TidalSessionStore {
  constructor(private readonly sessionPath: string) {}
  async load(): Promise<TidalSession | undefined> {
    try {
      return JSON.parse(
        await readFile(this.sessionPath, "utf8"),
      ) as TidalSession;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
  async save(session: TidalSession): Promise<void> {
    await mkdir(path.dirname(this.sessionPath), { recursive: true });
    const temporary = `${this.sessionPath}.tmp`;
    await writeFile(temporary, JSON.stringify(session), { mode: 0o600 });
    await rename(temporary, this.sessionPath);
  }
}
