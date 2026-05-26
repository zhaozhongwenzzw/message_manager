import { promises as fs } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { CODEX_ARCHIVED_DIR, CODEX_SESSIONS_DIR } from './paths';

/**
 * 把一个 Codex 会话从 sessions/ 移到 archived_sessions/，保留相对路径。
 * 例如 sessions/2026/05/rollout-xxx.jsonl → archived_sessions/2026/05/rollout-xxx.jsonl
 */
export async function archiveCodex(srcPath: string): Promise<{ newPath: string }> {
  if (!srcPath.startsWith(CODEX_SESSIONS_DIR + sep) && srcPath !== CODEX_SESSIONS_DIR) {
    throw new Error('archive: 路径不在 sessions/ 下：' + srcPath);
  }
  if (srcPath.startsWith(CODEX_ARCHIVED_DIR)) {
    throw new Error('archive: 已经是归档状态');
  }
  const rel = relative(CODEX_SESSIONS_DIR, srcPath);
  if (rel.startsWith('..' + sep) || rel === '..' || rel.includes('..' + sep)) {
    throw new Error('archive: 路径越界 ' + srcPath);
  }
  let dest = join(CODEX_ARCHIVED_DIR, rel);
  await fs.mkdir(dirname(dest), { recursive: true });

  try {
    await fs.access(dest);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    dest = dest + '.' + ts;
  } catch {
    // not exists
  }
  await fs.rename(srcPath, dest);
  return { newPath: dest };
}

/**
 * 反向：从 archived_sessions/ 移回 sessions/，保留相对路径。
 */
export async function unarchiveCodex(srcPath: string): Promise<{ newPath: string }> {
  if (!srcPath.startsWith(CODEX_ARCHIVED_DIR + sep) && srcPath !== CODEX_ARCHIVED_DIR) {
    throw new Error('unarchive: 路径不在 archived_sessions/ 下：' + srcPath);
  }
  const rel = relative(CODEX_ARCHIVED_DIR, srcPath);
  if (rel.startsWith('..' + sep) || rel === '..' || rel.includes('..' + sep)) {
    throw new Error('unarchive: 路径越界 ' + srcPath);
  }
  let dest = join(CODEX_SESSIONS_DIR, rel);
  await fs.mkdir(dirname(dest), { recursive: true });

  try {
    await fs.access(dest);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    dest = dest + '.' + ts;
  } catch {
    // not exists
  }
  await fs.rename(srcPath, dest);
  return { newPath: dest };
}
