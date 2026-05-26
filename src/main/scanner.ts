import { promises as fs, createReadStream } from 'node:fs';
import { join, basename } from 'node:path';
import { createInterface } from 'node:readline';
import {
  CLAUDE_PROJECTS_DIR,
  CODEX_ARCHIVED_DIR,
  CODEX_SESSIONS_DIR,
  decodeClaudeProjectName,
  shortLabel
} from './paths';
import { pLimit } from './limit';

export type SessionSummary = {
  source: 'claude' | 'codex';
  path: string;          // absolute path to source file
  id: string;            // session id derived from filename
  preview: string;       // first user message excerpt; empty if none
  timestamp: number;     // epoch ms; earliest known timestamp
  size: number;          // bytes
  messageCount: number;  // approx, by line count (cheap)
  projectKey: string;    // claude: encoded folder name, codex: YYYY-MM
  projectLabel: string;  // human-friendly label
  archived?: boolean;    // codex-only: true when path is under archived_sessions/
};

export type ClaudeProject = {
  key: string;           // encoded folder name
  label: string;         // best-effort decoded
  cwd?: string;          // real cwd if we saw it
  sessions: SessionSummary[];
};

const PREVIEW_LIMIT = 120;

// Read just enough of a JSONL to extract the first user message and cwd.
// Stops as soon as it finds them. Exported so the trash module can reuse the
// same logic to build previews for soft-deleted sessions.
export async function quickProbe(filePath: string): Promise<{
  preview: string;
  timestamp: number;
  cwd?: string;
  messageCount: number;
}> {
  const stat = await fs.stat(filePath);
  const stream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let preview = '';
  let cwd: string | undefined;
  let timestamp = stat.mtimeMs;
  let messageCount = 0;
  let timestampSet = false;

  for await (const line of rl) {
    if (!line.trim()) continue;
    messageCount++;
    let evt: any;
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }

    // Claude shape
    if (evt.type === 'user' && !preview) {
      const c = evt.message?.content;
      preview = extractText(c);
      if (evt.timestamp && !timestampSet) {
        timestamp = parseTimestamp(evt.timestamp);
        timestampSet = true;
      }
      if (evt.cwd && !cwd) cwd = evt.cwd;
    } else if (evt.cwd && !cwd) {
      cwd = evt.cwd;
    }

    // Codex shape: session_meta carries cwd + start time
    if (evt.type === 'session_meta' && evt.payload) {
      if (evt.payload.cwd && !cwd) cwd = evt.payload.cwd;
      if (evt.payload.timestamp && !timestampSet) {
        timestamp = parseTimestamp(evt.payload.timestamp);
        timestampSet = true;
      }
    }
    // Codex user messages
    if (!preview && (evt.type === 'message' || evt.type === 'user_message')) {
      const role = evt.role ?? evt.payload?.role;
      if (role === 'user') {
        preview = extractText(evt.content ?? evt.payload?.content ?? evt.payload?.text ?? '');
      }
    }
    if (!preview && evt.payload?.input_text) {
      preview = String(evt.payload.input_text);
    }

    if (preview && cwd && timestampSet) {
      // Got the essentials early; still need line count, but that's OK to estimate.
      break;
    }
  }
  rl.close();
  stream.destroy();

  // If we broke early we don't have full messageCount. Approximate using file size / 200.
  if (messageCount > 0 && stat.size > 0) {
    messageCount = Math.max(messageCount, Math.round(stat.size / 250));
  }

  return {
    preview: preview.slice(0, PREVIEW_LIMIT),
    timestamp,
    cwd,
    messageCount
  };
}

function parseTimestamp(s: string): number {
  const t = Date.parse(s);
  return Number.isNaN(t) ? Date.now() : t;
}

function extractText(content: unknown): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block === 'string') return block;
      if (block?.type === 'text' && typeof block.text === 'string') return block.text;
      if (block?.text && typeof block.text === 'string') return block.text;
    }
  }
  if (typeof content === 'object' && content && 'text' in content) {
    return String((content as any).text);
  }
  return '';
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const s = await fs.stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

export async function scanClaude(): Promise<ClaudeProject[]> {
  if (!(await dirExists(CLAUDE_PROJECTS_DIR))) return [];
  const entries = await fs.readdir(CLAUDE_PROJECTS_DIR, { withFileTypes: true });
  const limit = pLimit(8);

  const projects: ClaudeProject[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const folderPath = join(CLAUDE_PROJECTS_DIR, entry.name);
    let files: string[] = [];
    try {
      const inner = await fs.readdir(folderPath, { withFileTypes: true });
      files = inner.filter((e) => e.isFile() && e.name.endsWith('.jsonl')).map((e) => e.name);
    } catch {
      continue;
    }

    const sessions = await Promise.all(
      files.map((name) =>
        limit(async (): Promise<SessionSummary> => {
          const filePath = join(folderPath, name);
          const stat = await fs.stat(filePath);
          let probe: Awaited<ReturnType<typeof quickProbe>>;
          try {
            probe = await quickProbe(filePath);
          } catch {
            probe = { preview: '', timestamp: stat.mtimeMs, messageCount: 0 };
          }
          return {
            source: 'claude',
            path: filePath,
            id: basename(name, '.jsonl'),
            preview: probe.preview,
            timestamp: probe.timestamp,
            size: stat.size,
            messageCount: probe.messageCount,
            projectKey: entry.name,
            projectLabel: shortLabel(probe.cwd ?? decodeClaudeProjectName(entry.name))
          };
        })
      )
    );

    sessions.sort((a, b) => b.timestamp - a.timestamp);
    const cwd = sessions.find((s) => s.projectLabel)?.projectLabel;
    projects.push({
      key: entry.name,
      label: cwd ?? decodeClaudeProjectName(entry.name),
      sessions
    });
  }

  projects.sort((a, b) => {
    const at = a.sessions[0]?.timestamp ?? 0;
    const bt = b.sessions[0]?.timestamp ?? 0;
    return bt - at;
  });
  return projects;
}

export async function scanCodex(): Promise<SessionSummary[]> {
  const files: string[] = [];

  async function walk(dir: string): Promise<void> {
    if (!(await dirExists(dir))) return;
    const stack = [dir];
    while (stack.length) {
      const cur = stack.pop()!;
      let entries;
      try {
        entries = await fs.readdir(cur, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        const p = join(cur, e.name);
        if (e.isDirectory()) stack.push(p);
        else if (e.isFile() && (e.name.endsWith('.jsonl') || e.name.endsWith('.json')))
          files.push(p);
      }
    }
  }

  await walk(CODEX_SESSIONS_DIR);
  await walk(CODEX_ARCHIVED_DIR);

  const limit = pLimit(8);
  const sessions = await Promise.all(
    files.map((filePath) =>
      limit(async (): Promise<SessionSummary> => {
        const stat = await fs.stat(filePath);
        let probe: Awaited<ReturnType<typeof quickProbe>>;
        try {
          probe = await quickProbe(filePath);
        } catch {
          probe = { preview: '', timestamp: stat.mtimeMs, messageCount: 0 };
        }
        const d = new Date(probe.timestamp);
        const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const archived = filePath.startsWith(CODEX_ARCHIVED_DIR);
        return {
          source: 'codex',
          path: filePath,
          id: basename(filePath).replace(/\.(jsonl|json)$/, ''),
          preview: probe.preview,
          timestamp: probe.timestamp,
          size: stat.size,
          messageCount: probe.messageCount,
          projectKey: ym,
          projectLabel: probe.cwd ? shortLabel(probe.cwd) : ym,
          archived
        };
      })
    )
  );
  sessions.sort((a, b) => b.timestamp - a.timestamp);
  return sessions;
}
