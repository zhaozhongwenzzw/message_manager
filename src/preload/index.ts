import { contextBridge, ipcRenderer } from 'electron';

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
  openAppData: () => ipcRenderer.invoke('open:app-data')
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
