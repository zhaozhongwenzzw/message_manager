import { promises as fs } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import {
  CLAUDE_PROJECTS_DIR,
  CODEX_ARCHIVED_DIR,
  CODEX_SESSIONS_DIR,
  DEFAULT_TRASH_DIR,
  HOME
} from './paths';

export async function softDelete(
  source: 'claude' | 'codex',
  srcPath: string,
  trashRoot: string = DEFAULT_TRASH_DIR
): Promise<{ trashPath: string }> {
  // Resolve a stable relative path under <trashRoot>/<source>/...
  let rel: string;
  if (source === 'claude') {
    rel = relative(CLAUDE_PROJECTS_DIR, srcPath);
  } else {
    if (srcPath.startsWith(CODEX_SESSIONS_DIR)) rel = relative(CODEX_SESSIONS_DIR, srcPath);
    else if (srcPath.startsWith(CODEX_ARCHIVED_DIR))
      rel = join('archived', relative(CODEX_ARCHIVED_DIR, srcPath));
    else rel = relative(HOME, srcPath);
  }

  // Reject path traversal
  if (rel.startsWith('..' + sep) || rel === '..' || rel.includes('..' + sep)) {
    throw new Error('refusing to delete outside expected roots: ' + srcPath);
  }

  let dest = join(trashRoot, source, rel);
  await fs.mkdir(dirname(dest), { recursive: true });

  // Collision-safe
  try {
    await fs.access(dest);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    dest = dest + '.' + ts;
  } catch {
    // not exists, good
  }

  await fs.rename(srcPath, dest);
  return { trashPath: dest };
}

export async function softDeleteClaudeProject(
  projectKey: string,
  trashRoot: string = DEFAULT_TRASH_DIR
): Promise<{ trashPath: string }> {
  // Whitelist: must look like an encoded project folder, no separators
  if (!projectKey || projectKey.includes('/') || projectKey.includes('\\') || projectKey.includes('..')) {
    throw new Error('invalid project key: ' + projectKey);
  }
  const src = join(CLAUDE_PROJECTS_DIR, projectKey);
  const stat = await fs.stat(src);
  if (!stat.isDirectory()) throw new Error('not a directory: ' + src);

  let dest = join(trashRoot, 'claude', '__projects', projectKey);
  await fs.mkdir(dirname(dest), { recursive: true });
  try {
    await fs.access(dest);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    dest = dest + '.' + ts;
  } catch {
    // not exists
  }
  await fs.rename(src, dest);
  return { trashPath: dest };
}

