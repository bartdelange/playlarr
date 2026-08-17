import { mkdir, writeFile } from "node:fs/promises"; import path from "node:path"; import type { PlaylistExportResult } from "../application/playlist-export";
export function safeFilename(value: string): string { return value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-._]+|[-._]+$/g, "").slice(0, 80) || "playlist"; }
export function playlistOutputPath(outputDirectory: string, playlistName: string): string { return path.join(outputDirectory, `${safeFilename(playlistName)}.m3u8`); }
export function serializeM3u(exported: PlaylistExportResult): string { return ["#EXTM3U", ...exported.entries.flatMap((entry) => [`#EXTINF:-1,${[entry.artist, entry.title].filter(Boolean).map((value) => value.replace(/\n/g, " ")).join(" - ")}`, entry.path]), ""].join("\n"); }
export async function writeM3u(outputPath: string, exported: PlaylistExportResult): Promise<void> { await mkdir(path.dirname(outputPath), { recursive: true }); await writeFile(outputPath, serializeM3u(exported), "utf8"); }
