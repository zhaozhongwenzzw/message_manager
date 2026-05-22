import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { promises as fs } from 'node:fs';
import { scanClaude, scanCodex } from './scanner';
import { readSession } from './reader';
import { softDelete, softDeleteClaudeProject } from './deleter';
import { clearStar, listStars, toggleStar } from './star';
import { readConfig, writeConfig } from './store';
import {
  APP_DATA_DIR,
  CLAUDE_PROJECTS_DIR,
  CODEX_ARCHIVED_DIR,
  CODEX_SESSIONS_DIR,
  DEFAULT_TRASH_DIR
} from './paths';

// Lazy-loaded so dev mode (which doesn't ship electron-updater's CJS chain
// through Electron's Node ESM loader cleanly) doesn't crash on boot.
async function updaterModule(): Promise<typeof import('./updater')> {
  return await import('./updater');
}

async function resolveTrashDir(): Promise<string> {
  const cfg = await readConfig();
  const dir = cfg.trashDir?.trim() || DEFAULT_TRASH_DIR;
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export function registerIpc(): void {
  ipcMain.handle('scan:claude', () => scanClaude());
  ipcMain.handle('scan:codex', () => scanCodex());

  ipcMain.handle('read:session', async (_e, args: { path: string }) => {
    return readSession(args.path);
  });

  ipcMain.handle('delete:session', async (_e, args: { source: 'claude' | 'codex'; path: string }) => {
    const trash = await resolveTrashDir();
    const res = await softDelete(args.source, args.path, trash);
    await clearStar(args.path);
    return res;
  });

  ipcMain.handle('delete:claude-project', async (_e, args: { projectKey: string }) => {
    const trash = await resolveTrashDir();
    return softDeleteClaudeProject(args.projectKey, trash);
  });

  ipcMain.handle('star:list', () => listStars());
  ipcMain.handle('star:toggle', (_e, args: { path: string; starred: boolean }) =>
    toggleStar(args.path, args.starred)
  );

  ipcMain.handle('config:get', () => readConfig());
  ipcMain.handle('config:set', (_e, args: Awaited<ReturnType<typeof readConfig>>) =>
    writeConfig(args)
  );

  ipcMain.handle('open:trash', async () => {
    const dir = await resolveTrashDir();
    return shell.openPath(dir);
  });
  ipcMain.handle('open:app-data', () => shell.openPath(APP_DATA_DIR));

  ipcMain.handle('path:reveal', async (_e, args: { path: string }) => {
    return shell.openPath(args.path);
  });

  ipcMain.handle('dialog:pick-folder', async (e, args: { defaultPath?: string; title?: string }) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
    const opts: Electron.OpenDialogOptions = {
      title: args?.title ?? '选择文件夹',
      defaultPath: args?.defaultPath,
      properties: ['openDirectory', 'createDirectory']
    };
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (result.canceled || result.filePaths.length === 0) return null;
    const picked = result.filePaths[0];

    // Reject paths that overlap with the source dirs — moving sessions
    // inside their own source tree would scramble the next scan.
    const lower = picked.toLowerCase();
    const forbidden = [CLAUDE_PROJECTS_DIR, CODEX_SESSIONS_DIR, CODEX_ARCHIVED_DIR].map((p) =>
      p.toLowerCase()
    );
    if (forbidden.some((f) => lower === f || lower.startsWith(f + '\\') || lower.startsWith(f + '/'))) {
      return { error: '不能选择 Claude / Codex 的源目录或其子目录作为回收站。' };
    }
    return { path: picked };
  });

  ipcMain.handle('trash:default-path', () => DEFAULT_TRASH_DIR);

  ipcMain.handle('updater:status', async () => (await updaterModule()).getStatus());
  ipcMain.handle('updater:check', async () =>
    (await updaterModule()).checkForUpdates({ silent: false })
  );
  ipcMain.handle('updater:download', async () => (await updaterModule()).downloadUpdate());
  ipcMain.handle('updater:install', async () => {
    (await updaterModule()).quitAndInstall();
  });
}
