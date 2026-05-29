import type {
  AppConfig,
  ClaudeProject,
  LlmConfig,
  LlmStreamEvent,
  LlmTestResult,
  NormEvent,
  OpenTerminalResult,
  RestoreResult,
  SearchHit,
  SearchStatus,
  SessionSummary,
  Source,
  TrashEntry,
  UpdaterStatus
} from './types';

if (typeof window === 'undefined' || !window.api) {
  // Stub so that UI can render an error instead of crashing on undefined access.
  (window as any).api = new Proxy(
    {},
    {
      get() {
        return () =>
          Promise.reject(
            new Error('preload bridge unavailable. 检查 src/main/index.ts 中 preload 路径是否正确指向 out/preload/index.mjs')
          );
      }
    }
  );
}

export const api = {
  appVersion: () => window.api.appVersion() as Promise<string>,
  scanClaude: () => window.api.scanClaude() as Promise<ClaudeProject[]>,
  scanCodex: () => window.api.scanCodex() as Promise<SessionSummary[]>,
  readSession: (path: string) => window.api.readSession(path) as Promise<NormEvent[]>,
  deleteSession: (source: Source, path: string) =>
    window.api.deleteSession(source, path) as Promise<{ trashPath: string }>,
  deleteClaudeProject: (projectKey: string) =>
    window.api.deleteClaudeProject(projectKey) as Promise<{ trashPath: string }>,
  codexArchive: (path: string) =>
    window.api.codexArchive(path) as Promise<{ newPath: string }>,
  codexUnarchive: (path: string) =>
    window.api.codexUnarchive(path) as Promise<{ newPath: string }>,
  listStars: () => window.api.listStars() as Promise<Record<string, boolean>>,
  toggleStar: (path: string, starred: boolean) =>
    window.api.toggleStar(path, starred) as Promise<void>,
  listTags: () => window.api.listTags() as Promise<Record<string, string[]>>,
  setTags: (path: string, tags: string[]) => window.api.setTags(path, tags) as Promise<void>,
  listNotes: () => window.api.listNotes() as Promise<Record<string, string>>,
  setNote: (path: string, note: string) => window.api.setNote(path, note) as Promise<void>,
  getConfig: () => window.api.getConfig() as Promise<AppConfig>,
  setConfig: (cfg: AppConfig) => window.api.setConfig(cfg) as Promise<void>,
  openTrash: () => window.api.openTrash() as Promise<string>,
  openAppData: () => window.api.openAppData() as Promise<string>,
  revealPath: (path: string) => window.api.revealPath(path) as Promise<string>,
  pickFolder: (opts?: { defaultPath?: string; title?: string }) =>
    window.api.pickFolder(opts) as Promise<null | { path?: string; error?: string }>,
  pickFile: (opts?: {
    defaultPath?: string;
    title?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }) => window.api.pickFile(opts) as Promise<null | { path: string }>,
  trashDefaultPath: () => window.api.trashDefaultPath() as Promise<string>,
  trashList: () => window.api.trashList() as Promise<TrashEntry[]>,
  trashRestore: (args: { trashPath: string; mode?: 'overwrite' | 'rename' }) =>
    window.api.trashRestore(args) as Promise<RestoreResult>,
  trashPurge: (trashPath: string) => window.api.trashPurge(trashPath) as Promise<void>,
  trashEmpty: () => window.api.trashEmpty() as Promise<void>,
  // Search
  searchQuery: (args: { query: string; source?: Source }) =>
    window.api.searchQuery(args) as Promise<SearchHit[]>,
  searchStatus: () => window.api.searchStatus() as Promise<SearchStatus>,
  searchRebuild: () =>
    window.api.searchRebuild() as Promise<{ added: number; durationMs: number }>,
  // LLM
  llmConfigGet: () => window.api.llmConfigGet() as Promise<LlmConfig>,
  llmConfigSet: (args: Partial<LlmConfig> & { apiKey?: string }) =>
    window.api.llmConfigSet(args) as Promise<LlmConfig>,
  llmTestConnection: () => window.api.llmTestConnection() as Promise<LlmTestResult>,
  llmSummarizeStart: (args: { sessionPath: string }) =>
    window.api.llmSummarizeStart(args) as Promise<{ streamId: string }>,
  llmSummarizeCancel: (args: { streamId: string }) =>
    window.api.llmSummarizeCancel(args) as Promise<void>,
  onLlmStream: (cb: (ev: LlmStreamEvent) => void) =>
    window.api.onLlmStream((ev: unknown) => cb(ev as LlmStreamEvent)),
  // Terminal resume
  terminalOpen: (args: { source: Source; sessionPath: string; cwd?: string }) =>
    window.api.terminalOpen(args) as Promise<OpenTerminalResult>,
  saveFile: (args: {
    defaultPath?: string;
    title?: string;
    content: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }) => window.api.saveFile(args) as Promise<null | { path: string }>,
  // Updater
  updaterStatus: () => window.api.updaterStatus() as Promise<UpdaterStatus>,
  updaterCheck: () => window.api.updaterCheck() as Promise<UpdaterStatus>,
  updaterDownload: () => window.api.updaterDownload() as Promise<UpdaterStatus>,
  updaterInstall: () => window.api.updaterInstall() as Promise<void>,
  onUpdaterStatus: (cb: (s: UpdaterStatus) => void) =>
    window.api.onUpdaterStatus((s: unknown) => cb(s as UpdaterStatus))
};
