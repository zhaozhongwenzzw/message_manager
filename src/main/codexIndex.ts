import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { HOME } from './paths';

/**
 * 读 ~/.codex/session_index.jsonl，建 session id → thread_name 的索引。
 * Codex 自己会给每个会话生成一个简短的 thread_name（类似 "Fix PyCharm port lock access"），
 * 比我们从会话文件首条 user 消息里抠出的 system prompt 噪声小得多。
 *
 * 文件不存在 / 解析失败 → 返回空 Map（功能降级，不阻断扫描）。
 */
export const CODEX_SESSION_INDEX_FILE = join(HOME, '.codex', 'session_index.jsonl');

export async function loadCodexThreadNames(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let stream;
  try {
    stream = createReadStream(CODEX_SESSION_INDEX_FILE, { encoding: 'utf-8' });
  } catch {
    return map;
  }
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const ent = JSON.parse(line) as { id?: string; thread_name?: string };
        if (ent.id && ent.thread_name) {
          map.set(ent.id, ent.thread_name);
        }
      } catch {
        // skip malformed line
      }
    }
  } catch {
    // ENOENT or read error — fall through with whatever we got (likely empty)
  } finally {
    rl.close();
    stream.destroy();
  }
  return map;
}
