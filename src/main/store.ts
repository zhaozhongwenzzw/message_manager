import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { APP_DATA_DIR, CONFIG_FILE, DEFAULT_TRASH_DIR, METADATA_FILE } from './paths';

export async function ensureAppDirs(): Promise<void> {
  await fs.mkdir(APP_DATA_DIR, { recursive: true });
  await fs.mkdir(DEFAULT_TRASH_DIR, { recursive: true });
}

async function readJsonSafe<T>(file: string, fallback: T): Promise<T> {
  try {
    const txt = await fs.readFile(file, 'utf-8');
    return JSON.parse(txt) as T;
  } catch {
    return fallback;
  }
}

// Per-file write queue to prevent concurrent writes from racing on Windows
// (rename to an existing destination can EPERM if another process has it open).
const writeChains = new Map<string, Promise<void>>();

export async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await fs.mkdir(dirname(file), { recursive: true });
  const prev = writeChains.get(file) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(async () => {
    const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
      // Retry rename on Windows EPERM (transient file lock from indexing/AV).
      let attempts = 0;
      while (true) {
        try {
          await fs.rename(tmp, file);
          break;
        } catch (err: any) {
          if (err?.code === 'EPERM' && attempts < 5) {
            attempts++;
            await new Promise((r) => setTimeout(r, 50 * attempts));
            continue;
          }
          throw err;
        }
      }
    } catch (err) {
      try {
        await fs.unlink(tmp);
      } catch {
        // ignore
      }
      throw err;
    }
  });
  writeChains.set(file, next);
  try {
    await next;
  } finally {
    if (writeChains.get(file) === next) writeChains.delete(file);
  }
}

export type Metadata = {
  // keyed by absolute source file path
  stars: Record<string, boolean>;
};

export async function readMetadata(): Promise<Metadata> {
  const data = await readJsonSafe<Partial<Metadata>>(METADATA_FILE, {});
  return { stars: data.stars ?? {} };
}

export async function writeMetadata(m: Metadata): Promise<void> {
  await writeJsonAtomic(METADATA_FILE, m);
}

export type Appearance = 'light' | 'dark' | 'system';

export type LlmConfig = {
  enabled: boolean;
  baseUrl: string;
  model: string;
  /** 上下文窗口（token），用于决定是否启用 map-reduce 分块。默认 128k。 */
  contextWindow: number;
  /** Set by the store when reading; never written from outside. */
  hasApiKey?: boolean;
};

export type AppConfig = {
  activeTab: 'claude' | 'codex';
  windowBounds?: { x?: number; y?: number; width: number; height: number };
  showStarredOnly: boolean;
  appearance: Appearance;
  /** Absolute path to use for the soft-delete trash. Undefined = use the
   *  default ~/.claude-manager/trash. Changing this does NOT move existing
   *  items — old trashed files remain at their original location. */
  trashDir?: string;
  llm?: LlmConfig;
};

const DEFAULT_LLM_CONFIG: LlmConfig = {
  enabled: false,
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  contextWindow: 128_000
};

const DEFAULT_CONFIG: AppConfig = {
  activeTab: 'claude',
  windowBounds: { width: 1400, height: 900 },
  showStarredOnly: false,
  appearance: 'system',
  llm: DEFAULT_LLM_CONFIG
};

export async function readConfig(): Promise<AppConfig> {
  const data = await readJsonSafe<Partial<AppConfig>>(CONFIG_FILE, {});
  const merged = { ...DEFAULT_CONFIG, ...data };
  merged.llm = { ...DEFAULT_LLM_CONFIG, ...(data.llm ?? {}) };
  return merged;
}

export async function writeConfig(c: AppConfig): Promise<void> {
  await writeJsonAtomic(CONFIG_FILE, c);
}
