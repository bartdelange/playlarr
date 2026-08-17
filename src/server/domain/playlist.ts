export interface PlaylistInfo { source: string; id: string; name: string; path?: string; trackCount?: number; isFollowed?: boolean; owner?: string }
export interface SourceTrack { source: string; sourceTrackId: string; title: string; artists: string[]; album: string; isrc?: string; durationMs?: number }
export interface AcquiredTrack { position: number; track: SourceTrack; skipReason?: string }
export interface StoredImport { id: string; source: string; sourcePlaylistId: string; playlistName: string; playlistPath?: string; workflowState: string; createdAt: string; updatedAt: string; lastError?: string }
export interface StoredEntry { id: number; importId: string; position: number; track: SourceTrack; resolutionState: string; isManual: boolean }
