import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { promises as fs } from 'node:fs';
import { scanClaude, scanCodex } from './scanner';
import { readSession } from './reader';
import { softDelete, softDeleteClaudeProject } from './deleter';
import { archiveCodex, unarchiveCodex } from './archive';
import {
  clearSessionMeta,
  listNotes,
  listStars,
  listTags,
  setNote,
  setTags,
  toggleStar
} from './star';
import { readConfig, writeConfig, type LlmConfig } from './store';
import { emptyTrash, listTrash, purgeFromTrash, restoreFromTrash, type RestoreArgs } from './trash';
import { openInTerminal } from './terminal';
import {
  getSearchStatus,
  rebuildIndex,
  removeSessionFromIndex,
  search as searchIndex,
  syncSearchIndex,
  type SyncInput
} from './search';
import {
  cancelStream,
  getLlmConfig,
  newStreamId,
  setLlmConfig,
  summarizeSession,
  testConnection
} from './llm';
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

// Track most recent scan output per source. When either source finishes, we
// fire a search index sync over the *union* — otherwise scanning one source
// would erase the other source's docs (since syncSearchIndex treats anything
// not in the input list as removed).
let lastClaudeSync: SyncInput[] = [];
let lastCodexSync: SyncInput[] = [];
let lastClaudeReady = false;
let lastCodexReady = false;
let syncInFlight: Promise<void> | null = null;

async function scheduleSyncFromScans(
  claudeProjects: Awaited<ReturnType<typeof scanClaude>> | null,
  codexSessions: Awaited<ReturnType<typeof scanCodex>> | null
): Promise<void> {
  if (claudeProjects) {
    lastClaudeSync = claudeProjects.flatMap((p) =>
      p.sessions.map<SyncInput>((s) => ({
        path: s.path,
        source: 'claude',
        size: s.size,
        projectKey: s.projectKey,
        projectLabel: s.projectLabel
      }))
    );
    lastClaudeReady = true;
  }
  if (codexSessions) {
    lastCodexSync = codexSessions.map<SyncInput>((s) => ({
      path: s.path,
      source: 'codex',
      size: s.size,
      projectKey: s.projectKey,
      projectLabel: s.projectLabel
    }));
    lastCodexReady = true;
  }
  if (!lastClaudeReady || !lastCodexReady) return;

  if (syncInFlight) {
    await syncInFlight.catch(() => {});
  }
  syncInFlight = (async () => {
    try {
      await syncSearchIndex([...lastClaudeSync, ...lastCodexSync]);
    } catch (err) {
      console.warn('[search] sync failed:', err);
    }
  })();
  await syncInFlight;
  syncInFlight = null;
}

export function registerIpc(): void {
  ipcMain.handle('app:version', () => app.getVersion());

  ipcMain.handle('scan:claude', async () => {
    const projects = await scanClaude();
    void scheduleSyncFromScans(projects, null);
    return projects;
  });
  ipcMain.handle('scan:codex', async () => {
    const sessions = await scanCodex();
    void scheduleSyncFromScans(null, sessions);
    return sessions;
  });

  ipcMain.handle('read:session', async (_e, args: { path: string }) => {
    return readSession(args.path);
  });

  ipcMain.handle('delete:session', async (_e, args: { source: 'claude' | 'codex'; path: string }) => {
    const trash = await resolveTrashDir();
    const res = await softDelete(args.source, args.path, trash);
    await clearSessionMeta(args.path);
    void removeSessionFromIndex(args.path);
    return res;
  });

  ipcMain.handle('delete:claude-project', async (_e, args: { projectKey: string }) => {
    const trash = await resolveTrashDir();
    return softDeleteClaudeProject(args.projectKey, trash);
  });

  ipcMain.handle('codex:archive', async (_e, args: { path: string }) => {
    const res = await archiveCodex(args.path);
    // Keep search index in sync: old path is gone, new path will be picked up
    // on the next scan. Remove the stale doc now so search doesn't return a
    // dead path between archive and the next scan completion.
    void removeSessionFromIndex(args.path);
    return res;
  });

  ipcMain.handle('codex:unarchive', async (_e, args: { path: string }) => {
    const res = await unarchiveCodex(args.path);
    void removeSessionFromIndex(args.path);
    return res;
  });

  ipcMain.handle('star:list', () => listStars());
  ipcMain.handle('star:toggle', (_e, args: { path: string; starred: boolean }) =>
    toggleStar(args.path, args.starred)
  );

  ipcMain.handle('tags:list', () => listTags());
  ipcMain.handle('tags:set', (_e, args: { path: string; tags: string[] }) =>
    setTags(args.path, args.tags)
  );
  ipcMain.handle('notes:list', () => listNotes());
  ipcMain.handle('notes:set', (_e, args: { path: string; note: string }) =>
    setNote(args.path, args.note)
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

  ipcMain.handle(
    'dialog:pick-file',
    async (
      e,
      args: { defaultPath?: string; title?: string; filters?: Electron.FileFilter[] }
    ) => {
      const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
      const opts: Electron.OpenDialogOptions = {
        title: args?.title ?? '选择文件',
        defaultPath: args?.defaultPath,
        filters: args?.filters,
        properties: ['openFile']
      };
      const result = win
        ? await dialog.showOpenDialog(win, opts)
        : await dialog.showOpenDialog(opts);
      if (result.canceled || result.filePaths.length === 0) return null;
      return { path: result.filePaths[0] };
    }
  );

  ipcMain.handle('trash:default-path', () => DEFAULT_TRASH_DIR);

  ipcMain.handle('trash:list', async () => listTrash(await resolveTrashDir()));
  ipcMain.handle('trash:restore', async (_e, args: RestoreArgs) =>
    restoreFromTrash(await resolveTrashDir(), args)
  );
  ipcMain.handle('trash:purge', async (_e, args: { trashPath: string }) =>
    purgeFromTrash(await resolveTrashDir(), args.trashPath)
  );
  ipcMain.handle('trash:empty', async () => emptyTrash(await resolveTrashDir()));

  ipcMain.handle(
    'search:query',
    (_e, args: { query: string; source?: 'claude' | 'codex' }) =>
      searchIndex(args.query, { source: args.source })
  );
  ipcMain.handle('search:status', () => getSearchStatus());
  ipcMain.handle('search:rebuild', async () => {
    const [projects, codex] = await Promise.all([scanClaude(), scanCodex()]);
    const all: SyncInput[] = [
      ...projects.flatMap((p) =>
        p.sessions.map<SyncInput>((s) => ({
          path: s.path,
          source: 'claude',
          size: s.size,
          projectKey: s.projectKey,
          projectLabel: s.projectLabel
        }))
      ),
      ...codex.map<SyncInput>((s) => ({
        path: s.path,
        source: 'codex',
        size: s.size,
        projectKey: s.projectKey,
        projectLabel: s.projectLabel
      }))
    ];
    lastClaudeSync = all.filter((s) => s.source === 'claude');
    lastCodexSync = all.filter((s) => s.source === 'codex');
    lastClaudeReady = true;
    lastCodexReady = true;
    return rebuildIndex(all);
  });

  // ─── LLM ────────────────────────────────────────────────────────────────
  ipcMain.handle('llm:config:get', () => getLlmConfig());
  ipcMain.handle(
    'llm:config:set',
    (_e, args: Partial<LlmConfig> & { apiKey?: string }) => setLlmConfig(args)
  );
  ipcMain.handle('llm:test-connection', () => testConnection());
  ipcMain.handle('llm:summarize:start', async (e, args: { sessionPath: string; format?: 'html' | 'markdown' }) => {
    const streamId = newStreamId();
    // Fire and forget; events stream over llm:stream
    void summarizeSession({
      streamId,
      sessionPath: args.sessionPath,
      format: args.format,
      sender: e.sender
    });
    return { streamId };
  });
  ipcMain.handle('llm:summarize:cancel', (_e, args: { streamId: string }) => {
    cancelStream(args.streamId);
  });

  // ─── Terminal resume ───────────────────────────────────────────────────
  ipcMain.handle(
    'terminal:open',
    (_e, args: { source: 'claude' | 'codex'; sessionPath: string; cwd?: string }) =>
      openInTerminal(args)
  );

  // ─── File save dialog (used by summarize export) ───────────────────────
  ipcMain.handle(
    'dialog:save-file',
    async (
      e,
      args: { defaultPath?: string; title?: string; content: string; filters?: Electron.FileFilter[] }
    ) => {
      const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
      const opts: Electron.SaveDialogOptions = {
        title: args?.title ?? '保存文件',
        defaultPath: args?.defaultPath,
        filters: args?.filters ?? [{ name: 'Markdown', extensions: ['md'] }]
      };
      const result = win
        ? await dialog.showSaveDialog(win, opts)
        : await dialog.showSaveDialog(opts);
      if (result.canceled || !result.filePath) return null;
      await fs.writeFile(result.filePath, args.content, 'utf-8');
      return { path: result.filePath };
    }
  );

  ipcMain.handle('updater:status', async () => (await updaterModule()).getStatus());
  ipcMain.handle('updater:check', async () =>
    (await updaterModule()).checkForUpdates({ silent: false })
  );
  ipcMain.handle('updater:download', async () => (await updaterModule()).downloadUpdate());
  ipcMain.handle('updater:install', async () => {
    (await updaterModule()).quitAndInstall();
  });
}
