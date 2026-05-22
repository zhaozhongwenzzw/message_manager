import { homedir } from 'node:os';
import { join } from 'node:path';

export const HOME = homedir();
export const CLAUDE_PROJECTS_DIR = join(HOME, '.claude', 'projects');
export const CODEX_SESSIONS_DIR = join(HOME, '.codex', 'sessions');
export const CODEX_ARCHIVED_DIR = join(HOME, '.codex', 'archived_sessions');
export const APP_DATA_DIR = join(HOME, '.claude-manager');
export const DEFAULT_TRASH_DIR = join(APP_DATA_DIR, 'trash');
/** @deprecated use the trashDir resolved from config (DEFAULT_TRASH_DIR when unset). */
export const TRASH_DIR = DEFAULT_TRASH_DIR;
export const METADATA_FILE = join(APP_DATA_DIR, 'metadata.json');
export const CONFIG_FILE = join(APP_DATA_DIR, 'config.json');

// Claude encodes project paths like:
//   D:\custorm\message_manager  ->  D--custorm-message-manager
// Both `\` and `_` become `-`, and `:` becomes `--`. Lossy, so we use this as
// a display-only fallback when no session in the project carries an explicit cwd.
export function decodeClaudeProjectName(folderName: string): string {
  const parts = folderName.split('-');
  if (parts.length >= 2 && parts[1] === '' && parts[0].length === 1) {
    const drive = parts[0];
    const rest = parts.slice(2).filter((p) => p.length > 0);
    return `${drive}:\\${rest.join('\\')}`;
  }
  return folderName.replace(/-+/g, '/');
}

// Shortest informative label: tail folder of the cwd path.
export function shortLabel(cwd: string): string {
  const normalized = cwd.replace(/\\/g, '/').replace(/\/$/, '');
  const tail = normalized.split('/').pop() || normalized;
  return tail;
}
