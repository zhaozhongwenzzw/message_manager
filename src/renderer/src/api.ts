import type {
  AppConfig,
  ClaudeProject,
  NormEvent,
  RestoreResult,
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
  scanClaude: () => window.api.scanClaude() as Promise<ClaudeProject[]>,
  scanCodex: () => window.api.scanCodex() as Promise<SessionSummary[]>,
  readSession: (path: string) => window.api.readSession(path) as Promise<NormEvent[]>,
  deleteSession: (source: Source, path: string) =>
    window.api.deleteSession(source, path) as Promise<{ trashPath: string }>,
  deleteClaudeProject: (projectKey: string) =>
    window.api.deleteClaudeProject(projectKey) as Promise<{ trashPath: string }>,
  listStars: () => window.api.listStars() as Promise<Record<string, boolean>>,
  toggleStar: (path: string, starred: boolean) =>
    window.api.toggleStar(path, starred) as Promise<void>,
  getConfig: () => window.api.getConfig() as Promise<AppConfig>,
  setConfig: (cfg: AppConfig) => window.api.setConfig(cfg) as Promise<void>,
  openTrash: () => window.api.openTrash() as Promise<string>,
  openAppData: () => window.api.openAppData() as Promise<string>,
  revealPath: (path: string) => window.api.revealPath(path) as Promise<string>,
  pickFolder: (opts?: { defaultPath?: string; title?: string }) =>
    window.api.pickFolder(opts) as Promise<null | { path?: string; error?: string }>,
  trashDefaultPath: () => window.api.trashDefaultPath() as Promise<string>,
  trashList: () => window.api.trashList() as Promise<TrashEntry[]>,
  trashRestore: (args: { trashPath: string; mode?: 'overwrite' | 'rename' }) =>
    window.api.trashRestore(args) as Promise<RestoreResult>,
  trashPurge: (trashPath: string) => window.api.trashPurge(trashPath) as Promise<void>,
  trashEmpty: () => window.api.trashEmpty() as Promise<void>,
  // Updater
  updaterStatus: () => window.api.updaterStatus() as Promise<UpdaterStatus>,
  updaterCheck: () => window.api.updaterCheck() as Promise<UpdaterStatus>,
  updaterDownload: () => window.api.updaterDownload() as Promise<UpdaterStatus>,
  updaterInstall: () => window.api.updaterInstall() as Promise<void>,
  onUpdaterStatus: (cb: (s: UpdaterStatus) => void) =>
    window.api.onUpdaterStatus((s: unknown) => cb(s as UpdaterStatus))
};
