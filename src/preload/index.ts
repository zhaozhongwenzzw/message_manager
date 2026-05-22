import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

const api = {
  scanClaude: () => ipcRenderer.invoke('scan:claude'),
  scanCodex: () => ipcRenderer.invoke('scan:codex'),
  readSession: (path: string) => ipcRenderer.invoke('read:session', { path }),
  deleteSession: (source: 'claude' | 'codex', path: string) =>
    ipcRenderer.invoke('delete:session', { source, path }),
  deleteClaudeProject: (projectKey: string) =>
    ipcRenderer.invoke('delete:claude-project', { projectKey }),
  listStars: () => ipcRenderer.invoke('star:list'),
  toggleStar: (path: string, starred: boolean) =>
    ipcRenderer.invoke('star:toggle', { path, starred }),
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (cfg: unknown) => ipcRenderer.invoke('config:set', cfg),
  openTrash: () => ipcRenderer.invoke('open:trash'),
  openAppData: () => ipcRenderer.invoke('open:app-data'),
  // Updater
  updaterStatus: () => ipcRenderer.invoke('updater:status'),
  updaterCheck: () => ipcRenderer.invoke('updater:check'),
  updaterInstall: () => ipcRenderer.invoke('updater:install'),
  onUpdaterStatus: (cb: (status: unknown) => void) => {
    const handler = (_e: IpcRendererEvent, status: unknown): void => cb(status);
    ipcRenderer.on('updater:status', handler);
    return () => ipcRenderer.removeListener('updater:status', handler);
  }
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
