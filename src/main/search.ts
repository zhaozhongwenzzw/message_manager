import { promises as fs } from 'node:fs';
import MiniSearch from 'minisearch';
import { SEARCH_INDEX_FILE, SEARCH_MANIFEST_FILE } from './paths';
import { writeJsonAtomic } from './store';
import { readSession, type NormEvent } from './reader';
import { pLimit } from './limit';

export type Source = 'claude' | 'codex';

export type SearchDoc = {
  id: string;
  sessionPath: string;
  source: Source;
  projectKey: string;
  projectLabel: string;
  eventIndex: number;
  kind: NormEvent['kind'];
  text: string;
  ts?: number;
};

export type SearchHit = {
  sessionPath: string;
  source: Source;
  projectKey: string;
  projectLabel: string;
  ts?: number;
  matches: Array<{
    eventIndex: number;
    kind: NormEvent['kind'];
    excerpt: string;
    score: number;
  }>;
  bestScore: number;
};

export type SearchStatus = {
  indexedSessions: number;
  totalDocs: number;
  lastBuildAt?: number;
  building: boolean;
  buildProgress?: { done: number; total: number };
};

type ManifestEntry = {
  size: number;
  eventCount: number;
  indexedAt: number;
  source: Source;
  projectKey: string;
  projectLabel: string;
};

type SearchManifest = {
  version: number;
  lastBuildAt?: number;
  sessions: Record<string, ManifestEntry>;
};

const MANIFEST_VERSION = 1;
const PER_EVENT_TEXT_CAP = 2000;
const TOOL_EVENT_TEXT_CAP = 500;
const PROJECT_LABEL_BOOST = 1.5;
const KIND_WEIGHTS: Record<NormEvent['kind'], number> = {
  user: 2.0,
  assistant: 2.0,
  thinking: 1.0,
  tool_use: 0.5,
  tool_result: 0.5,
  meta: 0.2,
  unknown: 0.1,
  parse_error: 0.1
};

let mini: MiniSearch<SearchDoc> | null = null;
let manifest: SearchManifest = { version: MANIFEST_VERSION, sessions: {} };
let building = false;
let buildProgress: { done: number; total: number } | undefined;
let persistTimer: NodeJS.Timeout | null = null;
let initPromise: Promise<void> | null = null;

function newMiniSearch(): MiniSearch<SearchDoc> {
  return new MiniSearch<SearchDoc>({
    fields: ['text', 'projectLabel'],
    storeFields: [
      'sessionPath',
      'source',
      'projectKey',
      'projectLabel',
      'eventIndex',
      'kind',
      'text',
      'ts'
    ],
    idField: 'id',
    tokenize,
    processTerm: (term) => term.toLowerCase(),
    searchOptions: {
      tokenize,
      processTerm: (term) => term.toLowerCase(),
      prefix: true,
      combineWith: 'AND',
      boost: { projectLabel: PROJECT_LABEL_BOOST }
    }
  });
}

export function tokenize(text: string): string[] {
  if (!text) return [];
  const tokens: string[] = [];
  const ascii = text.match(/[A-Za-z0-9_]+/g);
  if (ascii) for (const w of ascii) tokens.push(w.toLowerCase());
  const cjk = text.match(/[㐀-鿿豈-﫿]+/g);
  if (cjk) {
    for (const run of cjk) {
      if (run.length === 1) {
        tokens.push(run);
        continue;
      }
      for (let i = 0; i < run.length - 1; i++) {
        tokens.push(run.slice(i, i + 2));
      }
    }
  }
  return tokens;
}

export async function initSearch(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      const [idxRaw, manifestRaw] = await Promise.all([
        fs.readFile(SEARCH_INDEX_FILE, 'utf-8').catch(() => null),
        fs.readFile(SEARCH_MANIFEST_FILE, 'utf-8').catch(() => null)
      ]);
      const mf = manifestRaw ? (JSON.parse(manifestRaw) as SearchManifest) : null;
      if (mf && mf.version === MANIFEST_VERSION && idxRaw) {
        mini = MiniSearch.loadJSON<SearchDoc>(idxRaw, {
          fields: ['text', 'projectLabel'],
          storeFields: [
            'sessionPath',
            'source',
            'projectKey',
            'projectLabel',
            'eventIndex',
            'kind',
            'text',
            'ts'
          ],
          idField: 'id',
          tokenize,
          processTerm: (term) => term.toLowerCase(),
          searchOptions: {
            tokenize,
            processTerm: (term) => term.toLowerCase(),
            prefix: true,
            combineWith: 'AND',
            boost: { projectLabel: PROJECT_LABEL_BOOST }
          }
        });
        manifest = mf;
        return;
      }
    } catch (err) {
      console.warn('[search] failed to load index, starting empty:', err);
    }
    mini = newMiniSearch();
    manifest = { version: MANIFEST_VERSION, sessions: {} };
  })();
  return initPromise;
}

function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistNow();
  }, 5000);
}

async function persistNow(): Promise<void> {
  if (!mini) return;
  try {
    manifest.lastBuildAt = Date.now();
    await writeJsonAtomic(SEARCH_INDEX_FILE, mini.toJSON());
    await writeJsonAtomic(SEARCH_MANIFEST_FILE, manifest);
  } catch (err) {
    console.warn('[search] persist failed:', err);
  }
}

export async function flushSearchPersist(): Promise<void> {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  await persistNow();
}

function clipText(s: string, cap: number): string {
  if (!s) return '';
  return s.length > cap ? s.slice(0, cap) : s;
}

function eventToText(ev: NormEvent): { text: string; weight: number } | null {
  const weight = KIND_WEIGHTS[ev.kind] ?? 0.5;
  switch (ev.kind) {
    case 'user':
    case 'assistant':
    case 'thinking':
      return { text: clipText(ev.text ?? '', PER_EVENT_TEXT_CAP), weight };
    case 'tool_use': {
      const inp = ev.input ? safeStringify(ev.input) : '';
      const txt = `${ev.name} ${inp}`.trim();
      return { text: clipText(txt, TOOL_EVENT_TEXT_CAP), weight };
    }
    case 'tool_result':
      return { text: clipText(ev.content ?? '', TOOL_EVENT_TEXT_CAP), weight };
    default:
      return null;
  }
}

function safeStringify(v: unknown): string {
  try {
    return typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    return '';
  }
}

function removeDocsForSession(sessionPath: string): void {
  if (!mini) return;
  const prev = manifest.sessions[sessionPath];
  if (!prev) return;
  for (let i = 0; i < prev.eventCount; i++) {
    const id = `${sessionPath}#${i}`;
    if (mini.has(id)) {
      try {
        mini.discard(id);
      } catch {
        // ignore
      }
    }
  }
}

export async function indexSession(
  filePath: string,
  source: Source,
  projectKey: string,
  projectLabel: string
): Promise<{ added: number }> {
  await initSearch();
  if (!mini) throw new Error('search not initialized');

  removeDocsForSession(filePath);

  let events: NormEvent[];
  try {
    events = await readSession(filePath);
  } catch {
    delete manifest.sessions[filePath];
    return { added: 0 };
  }

  const docs: SearchDoc[] = [];
  for (const ev of events) {
    if (ev.kind === 'parse_error' || ev.kind === 'unknown' || ev.kind === 'meta') continue;
    const t = eventToText(ev);
    if (!t || !t.text) continue;
    docs.push({
      id: `${filePath}#${ev.index}`,
      sessionPath: filePath,
      source,
      projectKey,
      projectLabel,
      eventIndex: ev.index,
      kind: ev.kind,
      text: t.text,
      ts: ev.ts
    });
  }
  if (docs.length) mini.addAll(docs);

  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    stat = { size: 0 } as any;
  }
  manifest.sessions[filePath] = {
    size: stat.size,
    eventCount: events.length,
    indexedAt: Date.now(),
    source,
    projectKey,
    projectLabel
  };
  schedulePersist();
  return { added: docs.length };
}

export async function removeSessionFromIndex(filePath: string): Promise<void> {
  await initSearch();
  if (!mini) return;
  removeDocsForSession(filePath);
  delete manifest.sessions[filePath];
  schedulePersist();
}

export type SyncInput = {
  path: string;
  source: Source;
  size: number;
  projectKey: string;
  projectLabel: string;
};

export async function syncSearchIndex(
  sessions: SyncInput[]
): Promise<{ added: number; updated: number; removed: number; unchanged: number }> {
  await initSearch();
  if (!mini) throw new Error('search not initialized');

  const want = new Map(sessions.map((s) => [s.path, s] as const));

  // 1) Removals
  let removed = 0;
  for (const p of Object.keys(manifest.sessions)) {
    if (!want.has(p)) {
      removeDocsForSession(p);
      delete manifest.sessions[p];
      removed++;
    }
  }

  // 2) Adds / updates
  const tasks: SyncInput[] = [];
  let unchanged = 0;
  for (const s of sessions) {
    const prev = manifest.sessions[s.path];
    if (
      prev &&
      prev.size === s.size &&
      prev.projectKey === s.projectKey &&
      prev.projectLabel === s.projectLabel
    ) {
      unchanged++;
      continue;
    }
    tasks.push(s);
  }

  let added = 0;
  let updated = 0;
  if (tasks.length) {
    building = true;
    buildProgress = { done: 0, total: tasks.length };
    const limit = pLimit(4);
    try {
      await Promise.all(
        tasks.map((s) =>
          limit(async () => {
            const isUpdate = !!manifest.sessions[s.path];
            try {
              await indexSession(s.path, s.source, s.projectKey, s.projectLabel);
              if (isUpdate) updated++;
              else added++;
            } catch (err) {
              console.warn('[search] index failed for', s.path, err);
            }
            if (buildProgress) buildProgress.done++;
          })
        )
      );
    } finally {
      building = false;
      buildProgress = undefined;
    }
  }

  schedulePersist();
  return { added, updated, removed, unchanged };
}

export async function rebuildIndex(
  sessions: SyncInput[]
): Promise<{ added: number; durationMs: number }> {
  await initSearch();
  const start = Date.now();
  mini = newMiniSearch();
  manifest = { version: MANIFEST_VERSION, sessions: {} };
  const r = await syncSearchIndex(sessions);
  await flushSearchPersist();
  return { added: r.added + r.updated, durationMs: Date.now() - start };
}

function buildExcerpt(text: string, terms: string[]): string {
  const cap = 140;
  if (!text) return '';
  const lower = text.toLowerCase();
  let hit = -1;
  for (const t of terms) {
    const i = lower.indexOf(t.toLowerCase());
    if (i >= 0 && (hit < 0 || i < hit)) hit = i;
  }
  if (hit < 0) return text.length > cap ? text.slice(0, cap) + '…' : text;
  const start = Math.max(0, hit - 50);
  const end = Math.min(text.length, hit + 90);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return prefix + text.slice(start, end) + suffix;
}

export async function search(
  query: string,
  opts?: {
    source?: Source;
    limit?: number;
    perSessionLimit?: number;
  }
): Promise<SearchHit[]> {
  await initSearch();
  if (!mini) return [];
  const q = query.trim();
  if (!q) return [];

  const terms = tokenize(q);
  if (!terms.length) return [];

  const limit = opts?.limit ?? 50;
  const perSession = opts?.perSessionLimit ?? 5;

  const filter = opts?.source
    ? (r: any) => r.source === opts.source
    : undefined;

  const raw = mini.search(q, { filter });

  const bySession = new Map<string, SearchHit>();
  for (const r of raw) {
    const doc = r as unknown as SearchDoc & { score: number };
    let hit = bySession.get(doc.sessionPath);
    const kindWeight = KIND_WEIGHTS[doc.kind] ?? 0.5;
    const score = r.score * kindWeight;
    if (!hit) {
      hit = {
        sessionPath: doc.sessionPath,
        source: doc.source,
        projectKey: doc.projectKey,
        projectLabel: doc.projectLabel,
        ts: doc.ts,
        matches: [],
        bestScore: score
      };
      bySession.set(doc.sessionPath, hit);
    }
    if (hit.matches.length < perSession) {
      hit.matches.push({
        eventIndex: doc.eventIndex,
        kind: doc.kind,
        excerpt: buildExcerpt(doc.text, terms),
        score
      });
    }
    if (score > hit.bestScore) hit.bestScore = score;
  }

  const hits = [...bySession.values()];
  hits.sort((a, b) => b.bestScore - a.bestScore);
  for (const h of hits) h.matches.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

export function getSearchStatus(): SearchStatus {
  let totalDocs = 0;
  let indexedSessions = 0;
  for (const k of Object.keys(manifest.sessions)) {
    indexedSessions++;
    totalDocs += manifest.sessions[k].eventCount;
  }
  return {
    indexedSessions,
    totalDocs,
    lastBuildAt: manifest.lastBuildAt,
    building,
    buildProgress: buildProgress ? { ...buildProgress } : undefined
  };
}
