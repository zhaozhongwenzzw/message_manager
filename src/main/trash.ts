import { promises as fs } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import {
  CLAUDE_PROJECTS_DIR,
  CODEX_ARCHIVED_DIR,
  CODEX_SESSIONS_DIR,
  decodeClaudeProjectName,
  shortLabel
} from './paths';
import { pLimit } from './limit';
import { quickProbe } from './scanner';

export type TrashEntry = {
  id: string;
  source: 'claude' | 'codex';
  kind: 'session' | 'project';
  trashPath: string;
  originalPath: string;
  originalLabel: string;
  deletedAt: number;
  size: number;
  preview?: string;
  messageCount?: number;
  childCount?: number;
};

export type RestoreArgs = {
  trashPath: string;
  mode?: 'overwrite' | 'rename';
};

export type RestoreResult =
  | { ok: true; restoredPath: string }
  | { conflict: true; originalPath: string };

async function dirExists(p: string): Promise<boolean> {
  try {
    const s = await fs.stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function dirSize(p: string): Promise<{ size: number; childCount: number }> {
  let size = 0;
  let childCount = 0;
  const stack = [p];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries;
    try {
      entries = await fs.readdir(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const sub = join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(sub);
      } else if (e.isFile()) {
        childCount++;
        try {
          const st = await fs.stat(sub);
          size += st.size;
        } catch {
          // skip
        }
      }
    }
  }
  return { size, childCount };
}

// Map a path inside the trash root back to where it originally lived in the
// Claude/Codex source tree.
function resolveOriginalPath(
  trashRoot: string,
  trashPath: string
): { source: 'claude' | 'codex'; kind: 'session' | 'project'; originalPath: string } | null {
  const rel = relative(trashRoot, trashPath);
  if (!rel || rel.startsWith('..' + sep) || rel === '..') return null;

  const parts = rel.split(/[/\\]/);
  const head = parts[0];
  const rest = parts.slice(1);

  if (head === 'claude') {
    if (rest[0] === '__projects') {
      const projectKey = rest[1];
      if (!projectKey) return null;
      return {
        source: 'claude',
        kind: 'project',
        originalPath: join(CLAUDE_PROJECTS_DIR, projectKey)
      };
    }
    return {
      source: 'claude',
      kind: 'session',
      originalPath: join(CLAUDE_PROJECTS_DIR, ...rest)
    };
  }
  if (head === 'codex') {
    if (rest[0] === 'archived') {
      return {
        source: 'codex',
        kind: 'session',
        originalPath: join(CODEX_ARCHIVED_DIR, ...rest.slice(1))
      };
    }
    return {
      source: 'codex',
      kind: 'session',
      originalPath: join(CODEX_SESSIONS_DIR, ...rest)
    };
  }
  return null;
}

function safeUnderTrash(trashRoot: string, candidate: string): boolean {
  const rel = relative(trashRoot, candidate);
  return !!rel && !rel.startsWith('..' + sep) && rel !== '..';
}

export async function listTrash(trashRoot: string): Promise<TrashEntry[]> {
  if (!(await dirExists(trashRoot))) return [];

  const entries: TrashEntry[] = [];
  const limit = pLimit(8);
  const tasks: Promise<void>[] = [];

  async function walkSessionsDir(dir: string, source: 'claude' | 'codex'): Promise<void> {
    if (!(await dirExists(dir))) return;
    const stack = [dir];
    while (stack.length) {
      const cur = stack.pop()!;
      let inner;
      try {
        inner = await fs.readdir(cur, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of inner) {
        const p = join(cur, e.name);
        if (e.isDirectory()) {
          // Skip the special __projects folder under claude — handled below.
          if (source === 'claude' && cur === dir && e.name === '__projects') continue;
          stack.push(p);
        } else if (
          e.isFile() &&
          (e.name.endsWith('.jsonl') || e.name.endsWith('.json'))
        ) {
          tasks.push(
            limit(async () => {
              try {
                const stat = await fs.stat(p);
                const resolved = resolveOriginalPath(trashRoot, p);
                if (!resolved) return;
                let probe: Awaited<ReturnType<typeof quickProbe>>;
                try {
                  probe = await quickProbe(p);
                } catch {
                  probe = { preview: '', timestamp: stat.mtimeMs, messageCount: 0 };
                }
                const label = probe.cwd
                  ? shortLabel(probe.cwd)
                  : source === 'claude'
                  ? shortLabel(decodeClaudeProjectName(basename(dirname(p))))
                  : basename(p).replace(/\.(jsonl|json)$/, '');
                entries.push({
                  id: p,
                  source,
                  kind: 'session',
                  trashPath: p,
                  originalPath: resolved.originalPath,
                  originalLabel: label,
                  deletedAt: stat.mtimeMs,
                  size: stat.size,
                  preview: probe.preview,
                  messageCount: probe.messageCount
                });
              } catch {
                // skip unreadable
              }
            })
          );
        }
      }
    }
  }

  async function walkClaudeProjects(): Promise<void> {
    const root = join(trashRoot, 'claude', '__projects');
    if (!(await dirExists(root))) return;
    let inner;
    try {
      inner = await fs.readdir(root, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of inner) {
      if (!e.isDirectory()) continue;
      const p = join(root, e.name);
      tasks.push(
        limit(async () => {
          try {
            const stat = await fs.stat(p);
            const resolved = resolveOriginalPath(trashRoot, p);
            if (!resolved) return;
            const { size, childCount } = await dirSize(p);
            // Trash deleter may have appended `.<ISO>` if the key collided.
            // Strip that for the displayed label only.
            const cleanKey = e.name.replace(/\.\d{4}-\d{2}-\d{2}T[\d-]+Z?$/, '');
            entries.push({
              id: p,
              source: 'claude',
              kind: 'project',
              trashPath: p,
              originalPath: resolved.originalPath,
              originalLabel: shortLabel(decodeClaudeProjectName(cleanKey)),
              deletedAt: stat.mtimeMs,
              size,
              childCount
            });
          } catch {
            // skip
          }
        })
      );
    }
  }

  await walkSessionsDir(join(trashRoot, 'claude'), 'claude');
  await walkSessionsDir(join(trashRoot, 'codex'), 'codex');
  await walkClaudeProjects();
  await Promise.all(tasks);

  entries.sort((a, b) => b.deletedAt - a.deletedAt);
  return entries;
}

export async function restoreFromTrash(
  trashRoot: string,
  args: RestoreArgs
): Promise<RestoreResult> {
  const { trashPath, mode } = args;
  if (!safeUnderTrash(trashRoot, trashPath)) {
    throw new Error('refusing to restore: trashPath outside trash root');
  }
  const resolved = resolveOriginalPath(trashRoot, trashPath);
  if (!resolved) throw new Error('cannot resolve original path for: ' + trashPath);

  let dest = resolved.originalPath;
  let exists = false;
  try {
    await fs.access(dest);
    exists = true;
  } catch {
    exists = false;
  }

  if (exists && !mode) {
    return { conflict: true, originalPath: dest };
  }
  if (exists && mode === 'rename') {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    if (resolved.kind === 'project') {
      dest = `${dest}.restored.${ts}`;
    } else {
      const dotIdx = dest.lastIndexOf('.');
      const ext = dotIdx > 0 ? dest.slice(dotIdx) : '';
      const stem = dotIdx > 0 ? dest.slice(0, dotIdx) : dest;
      dest = `${stem}.restored.${ts}${ext}`;
    }
  } else if (exists && mode === 'overwrite') {
    await fs.rm(dest, { recursive: true, force: true });
  }

  await fs.mkdir(dirname(dest), { recursive: true });
  await fs.rename(trashPath, dest);
  return { ok: true, restoredPath: dest };
}

export async function purgeFromTrash(trashRoot: string, trashPath: string): Promise<void> {
  if (!safeUnderTrash(trashRoot, trashPath)) {
    throw new Error('refusing to purge: trashPath outside trash root');
  }
  await fs.rm(trashPath, { recursive: true, force: true });
}

export async function emptyTrash(trashRoot: string): Promise<void> {
  if (!(await dirExists(trashRoot))) return;
  for (const sub of ['claude', 'codex']) {
    const root = join(trashRoot, sub);
    if (!(await dirExists(root))) continue;
    let inner;
    try {
      inner = await fs.readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of inner) {
      const p = join(root, e.name);
      try {
        await fs.rm(p, { recursive: true, force: true });
      } catch {
        // continue on partial failures
      }
    }
  }
}
