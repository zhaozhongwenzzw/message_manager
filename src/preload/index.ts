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
  revealPath: (path: string) => ipcRenderer.invoke('path:reveal', { path }),
  pickFolder: (opts?: { defaultPath?: string; title?: string }) =>
    ipcRenderer.invoke('dialog:pick-folder', opts ?? {}),
  trashDefaultPath: () => ipcRenderer.invoke('trash:default-path'),
  trashList: () => ipcRenderer.invoke('trash:list'),
  trashRestore: (args: { trashPath: string; mode?: 'overwrite' | 'rename' }) =>
    ipcRenderer.invoke('trash:restore', args),
  trashPurge: (trashPath: string) => ipcRenderer.invoke('trash:purge', { trashPath }),
  trashEmpty: () => ipcRenderer.invoke('trash:empty'),
  // Search
  searchQuery: (args: { query: string; source?: 'claude' | 'codex' }) =>
    ipcRenderer.invoke('search:query', args),
  searchStatus: () => ipcRenderer.invoke('search:status'),
  searchRebuild: () => ipcRenderer.invoke('search:rebuild'),
  // Updater
  updaterStatus: () => ipcRenderer.invoke('updater:status'),
  updaterCheck: () => ipcRenderer.invoke('updater:check'),
  updaterDownload: () => ipcRenderer.invoke('updater:download'),
  updaterInstall: () => ipcRenderer.invoke('updater:install'),
  onUpdaterStatus: (cb: (status: unknown) => void) => {
    const handler = (_e: IpcRendererEvent, status: unknown): void => cb(status);
    ipcRenderer.on('updater:status', handler);
    return () => ipcRenderer.removeListener('updater:status', handler);
  }
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
