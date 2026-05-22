import type { AppConfig, ClaudeProject, NormEvent, SessionSummary, Source } from './types';

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
  openAppData: () => window.api.openAppData() as Promise<string>
};
