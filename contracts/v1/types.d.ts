export type Scope = { profileId: string; spaceId: string; taskId?: string;
  pageId?: string; pageRevision?: number };
export type Request = { protocol: 'tai.v1'; id: string; command: string;
  scope: Scope; payload: Record<string, unknown> };
export type Result<T = unknown> = { id: string; ok: true; value: T } |
  { id: string; ok: false; error: { code: string; message: string; retryable?: boolean } };
export type Event<T = unknown> = { protocol: 'tai.v1'; id: string;
  type: 'clip.saved' | 'destination.succeeded' | 'module.applied' | 'task.updated';
  scope: Scope; occurredAt: string; payload: T };
export interface ClipDocument {
  version: 1; id: string; revision: number; title: string; markdown: string;
  source: { url: string; profileId: string; spaceId: string; capturedAt: string; author?: string };
  tags: string[]; assets: { id: string; path: string; mimeType: string;
    status: 'saved' | 'missing' | 'remote' }[];
}
export interface ModuleManifest { apiVersion: 1; id: string; version: string; title: string;
  entry: string; surfaces: ('sidebar' | 'panel' | 'newtab')[];
  capabilities: ('storage' | 'notifications' | 'clips.read' | 'clips.capture')[] }
export type ImportedItem = { sourceId: string; title: string } & (
  { kind: 'folder'; children: ImportedItem[] } | { kind: 'page'; url: string });
export interface MigrationPlan { version: 1; source: 'chrome' | 'arc' | 'bookmarks-html';
  profiles: { sourceProfileId: string; name: string; favorites: ImportedItem[];
    spaces: { sourceSpaceId: string; name: string; color?: string;
      saved: ImportedItem[]; temporary: ImportedItem[] }[] }[];
  warnings: { code: string; sourceId?: string }[] }
export interface SettingDefinition { key: string; title: string;
  type: 'boolean' | 'string' | 'number' | 'select' | 'credential-reference';
  scope: 'app' | 'profile' | 'space' | 'library' | 'component';
  default?: unknown; options?: { value: string; label: string }[] }
