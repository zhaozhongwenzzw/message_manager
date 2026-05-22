import { ipcMain, shell } from 'electron';
import { scanClaude, scanCodex } from './scanner';
import { readSession } from './reader';
import { softDelete, softDeleteClaudeProject } from './deleter';
import { clearStar, listStars, toggleStar } from './star';
import { readConfig, writeConfig } from './store';
import { TRASH_DIR, APP_DATA_DIR } from './paths';
import { checkForUpdates, getStatus, quitAndInstall } from './updater';

export function registerIpc(): void {
  ipcMain.handle('scan:claude', () => scanClaude());
  ipcMain.handle('scan:codex', () => scanCodex());

  ipcMain.handle('read:session', async (_e, args: { path: string }) => {
    return readSession(args.path);
  });

  ipcMain.handle('delete:session', async (_e, args: { source: 'claude' | 'codex'; path: string }) => {
    const res = await softDelete(args.source, args.path);
    await clearStar(args.path);
    return res;
  });

  ipcMain.handle('delete:claude-project', async (_e, args: { projectKey: string }) => {
    return softDeleteClaudeProject(args.projectKey);
  });

  ipcMain.handle('star:list', () => listStars());
  ipcMain.handle('star:toggle', (_e, args: { path: string; starred: boolean }) =>
    toggleStar(args.path, args.starred)
  );

  ipcMain.handle('config:get', () => readConfig());
  ipcMain.handle('config:set', (_e, args: Awaited<ReturnType<typeof readConfig>>) =>
    writeConfig(args)
  );

  ipcMain.handle('open:trash', () => shell.openPath(TRASH_DIR));
  ipcMain.handle('open:app-data', () => shell.openPath(APP_DATA_DIR));

  ipcMain.handle('updater:status', () => getStatus());
  ipcMain.handle('updater:check', () => checkForUpdates({ silent: false }));
  ipcMain.handle('updater:install', () => {
    quitAndInstall();
  });
}
