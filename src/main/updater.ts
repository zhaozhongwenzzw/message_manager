import electronUpdater, { type UpdateInfo, type ProgressInfo } from 'electron-updater';
import type { BrowserWindow } from 'electron';

const { autoUpdater } = electronUpdater;

export type UpdaterStatus =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'available'; info: UpdateInfoLite }
  | { phase: 'not-available'; info?: UpdateInfoLite; checkedAt: number }
  | { phase: 'downloading'; info: UpdateInfoLite; progress: ProgressInfo }
  | { phase: 'downloaded'; info: UpdateInfoLite }
  | { phase: 'error'; message: string };

export type UpdateInfoLite = {
  version: string;
  releaseDate?: string;
  releaseNotes?: string;
};

let state: UpdaterStatus = { phase: 'idle' };
let target: BrowserWindow | null = null;
let autoCheckTimer: NodeJS.Timeout | null = null;

function send(): void {
  if (!target || target.isDestroyed()) return;
  target.webContents.send('updater:status', state);
}

function toLite(info: UpdateInfo): UpdateInfoLite {
  return {
    version: info.version,
    releaseDate: info.releaseDate,
    releaseNotes:
      typeof info.releaseNotes === 'string'
        ? info.releaseNotes
        : Array.isArray(info.releaseNotes)
        ? info.releaseNotes.map((n) => n.note ?? '').join('\n\n')
        : undefined
  };
}

export function getStatus(): UpdaterStatus {
  return state;
}

export function initUpdater(win: BrowserWindow): void {
  target = win;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => {
    state = { phase: 'checking' };
    send();
  });
  autoUpdater.on('update-available', (info: UpdateInfo) => {
    state = { phase: 'available', info: toLite(info) };
    send();
  });
  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    state = { phase: 'not-available', info: toLite(info), checkedAt: Date.now() };
    send();
  });
  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    const info =
      state.phase === 'downloading' || state.phase === 'available'
        ? state.info
        : { version: '?' };
    state = { phase: 'downloading', info, progress };
    send();
  });
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    state = { phase: 'downloaded', info: toLite(info) };
    send();
  });
  autoUpdater.on('error', (err: Error) => {
    state = { phase: 'error', message: err?.message ?? String(err) };
    send();
  });

  // First check a few seconds after the window is ready, so the UI is responsive first.
  setTimeout(() => {
    void checkForUpdates({ silent: true });
  }, 5_000);

  // Hourly background check.
  autoCheckTimer = setInterval(() => {
    void checkForUpdates({ silent: true });
  }, 60 * 60 * 1000);
}

export function disposeUpdater(): void {
  if (autoCheckTimer) {
    clearInterval(autoCheckTimer);
    autoCheckTimer = null;
  }
  target = null;
}

export async function checkForUpdates(opts: { silent?: boolean } = {}): Promise<UpdaterStatus> {
  try {
    await autoUpdater.checkForUpdates();
  } catch (err: any) {
    state = { phase: 'error', message: err?.message ?? String(err) };
    send();
    if (!opts.silent) throw err;
  }
  return state;
}

export function quitAndInstall(): void {
  // Note: this quits the app immediately and runs the NSIS installer in silent mode.
  autoUpdater.quitAndInstall(false, true);
}
