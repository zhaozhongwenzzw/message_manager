import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs, constants as fsc } from 'node:fs';
import { basename, extname } from 'node:path';
import { platform } from 'node:process';
import which from 'which';
import { readConfig } from './store';

/**
 * Open the OS terminal at <cwd> and run `claude --resume <id>` or `codex resume <id>`.
 *
 * Cross-platform spawn recipes:
 *   Win:   wt.exe -d <cwd> -- <cli-or-cmd-shim> [resume args]
 *          ↳ fallback: cmd.exe /c start "" /D <cwd> <cliPath> <resume args>
 *   macOS: osascript -e 'tell app "Terminal" to do script "cd … && … resume …"'
 *   Linux: gnome-terminal → konsole → xfce4-terminal → xterm（first found wins）
 *
 * All spawn calls use `shell: false` + argv arrays to avoid command injection.
 * AppleScript and xterm `-e` strings are shell-escaped per their syntax.
 * The child is detached + unref'd so the Recall app can close without dragging
 * the terminal with it.
 */

export type Source = 'claude' | 'codex';

export type OpenTerminalArgs = {
  source: Source;
  sessionPath: string;
  cwd?: string;
};

export type OpenTerminalError =
  | { code: 'cwd_missing'; cwd: string }
  | { code: 'cwd_not_set' }
  | { code: 'cli_not_found'; cli: Source }
  | { code: 'session_id_invalid'; raw: string }
  | { code: 'terminal_spawn_failed'; detail: string };

export type OpenTerminalResult =
  | { ok: true }
  | { ok: false; error: OpenTerminalError };

// ─── Pure helpers (exported for future unit tests) ────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_TAIL_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * Strip extension, then:
 *   Claude → filename IS a UUID, validate strictly
 *   Codex  → rollout-YYYY-MM-DDTHH-MM-SS-<uuid>, extract trailing UUID
 *            (also matches bare-UUID legacy files)
 * Returns null on shape mismatch.
 */
export function resolveSessionId(source: Source, sessionPath: string): string | null {
  const base = basename(sessionPath).replace(/\.(jsonl|json)$/i, '');
  if (source === 'claude') {
    return UUID_RE.test(base) ? base : null;
  }
  const m = base.match(UUID_TAIL_RE);
  return m ? m[1] : null;
}

/**
 * POSIX shell single-quote escape. Safe for any path passed inside `bash -c`
 * or AppleScript's `do script` body.
 */
export function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * AppleScript string-literal escape. Wrapping in `"..."` is the caller's job;
 * this just escapes backslashes and double-quotes within. Do NOT use
 * JSON.stringify — JSON emits `\uXXXX` which AppleScript does not parse.
 */
export function appleScriptEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Windows-only: .cmd / .bat shims cannot be invoked directly by
 * CreateProcess(). When the CLI was installed via npm, `claude.cmd` lives in
 * `%APPDATA%\npm` and must be wrapped with `cmd.exe /c`. Returns the argv
 * array that should follow the terminal launcher.
 */
export function wrapWinIfShim(cliPath: string, resumeArgs: string[]): string[] {
  const ext = extname(cliPath).toLowerCase();
  if (ext === '.cmd' || ext === '.bat') {
    return ['cmd.exe', '/c', cliPath, ...resumeArgs];
  }
  return [cliPath, ...resumeArgs];
}

export function buildResumeArgs(source: Source, id: string): string[] {
  return source === 'claude' ? ['--resume', id] : ['resume', id];
}

/**
 * Cross-platform "is this path a runnable executable?" check.
 *   Win:    file exists + extension in .exe/.cmd/.bat/.com/.ps1
 *           (X_OK is meaningless on NTFS for regular files)
 *   POSIX:  fs.access(path, X_OK)
 */
async function isExecutableFile(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    if (!st.isFile()) return false;
  } catch {
    return false;
  }
  if (platform === 'win32') {
    const ok = new Set(['.exe', '.cmd', '.bat', '.com', '.ps1']);
    return ok.has(extname(p).toLowerCase());
  }
  try {
    await fs.access(p, fsc.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function whichOnPath(name: string): Promise<string | null> {
  try {
    return await which(name);
  } catch {
    return null;
  }
}

async function hasOnPath(name: string): Promise<boolean> {
  return (await whichOnPath(name)) !== null;
}

// ─── CLI / cwd resolution ─────────────────────────────────────────────────

async function resolveCli(source: Source): Promise<string | null> {
  const cfg = await readConfig();
  const override =
    source === 'claude' ? cfg.terminal?.claudePath?.trim() : cfg.terminal?.codexPath?.trim();
  if (override) {
    return (await isExecutableFile(override)) ? override : null;
  }
  return await whichOnPath(source);
}

async function guardCwd(cwd?: string): Promise<OpenTerminalResult | null> {
  if (!cwd) return { ok: false, error: { code: 'cwd_not_set' } };
  try {
    const st = await fs.stat(cwd);
    if (!st.isDirectory()) return { ok: false, error: { code: 'cwd_missing', cwd } };
  } catch {
    return { ok: false, error: { code: 'cwd_missing', cwd } };
  }
  return null;
}

// ─── Platform spawn recipes ───────────────────────────────────────────────

type SpawnRecipe = { cmd: string; args: string[] };

async function buildArgvWin(
  cliPath: string,
  source: Source,
  cwd: string,
  id: string
): Promise<SpawnRecipe> {
  const resume = buildResumeArgs(source, id);
  if (await hasOnPath('wt.exe')) {
    const wrapped = wrapWinIfShim(cliPath, resume); // [exe, ...args]
    return { cmd: 'wt.exe', args: ['-d', cwd, '--', ...wrapped] };
  }
  // Fallback: cmd /c start uses ShellExecute which handles .cmd/.bat natively,
  // so we don't need wrapWinIfShim here.
  return { cmd: 'cmd.exe', args: ['/c', 'start', '""', '/D', cwd, cliPath, ...resume] };
}

function buildArgvMac(cliPath: string, source: Source, cwd: string, id: string): SpawnRecipe {
  const resume = buildResumeArgs(source, id);
  const inner = `cd ${shellEscape(cwd)} && ${shellEscape(cliPath)} ${resume.map(shellEscape).join(' ')}`;
  const script = `tell application "Terminal" to do script "${appleScriptEscape(inner)}"`;
  return { cmd: 'osascript', args: ['-e', script] };
}

async function buildArgvLinux(
  cliPath: string,
  source: Source,
  cwd: string,
  id: string
): Promise<SpawnRecipe | null> {
  const resume = buildResumeArgs(source, id);
  const cliArgs = [cliPath, ...resume];
  const escapedSingleString = cliArgs.map(shellEscape).join(' ');
  const candidates: SpawnRecipe[] = [
    { cmd: 'gnome-terminal', args: ['--working-directory', cwd, '--', ...cliArgs] },
    { cmd: 'konsole', args: ['--workdir', cwd, '-e', ...cliArgs] },
    { cmd: 'xfce4-terminal', args: [`--working-directory=${cwd}`, '-e', escapedSingleString] },
    { cmd: 'xterm', args: ['-e', `cd ${shellEscape(cwd)} && ${escapedSingleString}`] }
  ];
  for (const c of candidates) if (await hasOnPath(c.cmd)) return c;
  return null;
}

async function buildSpawnRecipe(
  cliPath: string,
  source: Source,
  cwd: string,
  id: string
): Promise<SpawnRecipe | null> {
  if (platform === 'win32') return await buildArgvWin(cliPath, source, cwd, id);
  if (platform === 'darwin') return buildArgvMac(cliPath, source, cwd, id);
  return await buildArgvLinux(cliPath, source, cwd, id);
}

// ─── Public entry point ───────────────────────────────────────────────────

export async function openInTerminal(args: OpenTerminalArgs): Promise<OpenTerminalResult> {
  // 1) cwd guard
  const cwdErr = await guardCwd(args.cwd);
  if (cwdErr) return cwdErr;
  const cwd = args.cwd as string; // narrowed by guardCwd

  // 2) CLI resolution
  const cliPath = await resolveCli(args.source);
  if (!cliPath) return { ok: false, error: { code: 'cli_not_found', cli: args.source } };

  // 3) session id normalization
  const sessionId = resolveSessionId(args.source, args.sessionPath);
  if (!sessionId) {
    return { ok: false, error: { code: 'session_id_invalid', raw: args.sessionPath } };
  }

  // 4) platform spawn recipe
  const recipe = await buildSpawnRecipe(cliPath, args.source, cwd, sessionId);
  if (!recipe) {
    return {
      ok: false,
      error: { code: 'terminal_spawn_failed', detail: 'no terminal emulator found' }
    };
  }

  // 5) spawn + race 'error' vs 'spawn'
  return await new Promise<OpenTerminalResult>((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(recipe.cmd, recipe.args, { detached: true, stdio: 'ignore' });
    } catch (e: any) {
      resolve({
        ok: false,
        error: { code: 'terminal_spawn_failed', detail: e?.message ?? String(e) }
      });
      return;
    }

    let settled = false;
    const settle = (r: OpenTerminalResult): void => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    child.once('error', (err) => {
      console.warn('[terminal] spawn error:', err);
      settle({ ok: false, error: { code: 'terminal_spawn_failed', detail: err.message } });
    });
    child.once('spawn', () => {
      child.unref();
      settle({ ok: true });
    });

    // Safety net: Node child_process is guaranteed to fire one of the two
    // events above. The 1s timeout is here purely so a hypothetical Node bug
    // doesn't leave the IPC pending forever.
    setTimeout(() => settle({ ok: true }), 1000);
  });
}
