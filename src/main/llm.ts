import { promises as fs } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { safeStorage, type WebContents } from 'electron';
import { LLM_KEY_FILE } from './paths';
import { readSession, type NormEvent } from './reader';
import { readConfig, writeConfig, type LlmConfig } from './store';

const SYSTEM_PROMPT = `你是一个对话压缩助手。把下面用户与助手的对话压缩成一份"续聊简报"，让接手的另一个 LLM 能从这里继续工作。

输出必须用 Markdown，包含以下小节（## 标题）：
- 用户目标：1-2 句话概括用户想做什么
- 关键决策：已达成的设计 / 技术决定，每条一行
- 当前状态：分「已完成 / 进行中 / 待办」三栏
- 涉及文件：路径 + 改动类型（新增 / 修改 / 删除）
- 下一步建议：接手者应该先做什么

要求：
- 总长度 800-1500 token，简洁但具体
- 保留具体名词（文件路径、函数名、技术栈、版本号）
- 不要复述工具调用的原始输出，只保留关键结论
- 不要解释你在做什么，直接输出简报`;

const PER_TOOL_RESULT_CAP = 400;
const PER_USER_ASSISTANT_CAP = 4000;
const DEFAULT_CONTEXT_WINDOW = 128_000;
// Rough heuristic: 1 token ≈ 3 chars for mixed CN/EN content.
const CHARS_PER_TOKEN = 3;

export type LlmStreamEvent =
  | {
      type: 'phase';
      streamId: string;
      phase: 'reading' | 'preparing' | 'generating';
      status: 'running' | 'done' | 'error';
      meta?: Record<string, unknown>;
    }
  | { type: 'token'; streamId: string; delta: string }
  | {
      type: 'done';
      streamId: string;
      fullText: string;
      usage?: { inputTokens?: number; outputTokens?: number };
    }
  | { type: 'error'; streamId: string; message: string };

const activeStreams = new Map<string, AbortController>();

// ─── API key (safeStorage) ───────────────────────────────────────────────

export function isEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

export async function saveApiKey(plain: string): Promise<void> {
  if (!plain) {
    await deleteApiKey();
    return;
  }
  if (!isEncryptionAvailable()) {
    throw new Error('系统密钥链不可用，无法安全存储 API Key');
  }
  const buf = safeStorage.encryptString(plain);
  await fs.writeFile(LLM_KEY_FILE, buf);
}

export async function loadApiKey(): Promise<string | null> {
  try {
    const buf = await fs.readFile(LLM_KEY_FILE);
    if (!isEncryptionAvailable()) return null;
    return safeStorage.decryptString(buf);
  } catch {
    return null;
  }
}

export async function deleteApiKey(): Promise<void> {
  try {
    await fs.unlink(LLM_KEY_FILE);
  } catch {
    // ignore
  }
}

export async function hasApiKey(): Promise<boolean> {
  try {
    await fs.access(LLM_KEY_FILE);
    return true;
  } catch {
    return false;
  }
}

// ─── Config wrappers ─────────────────────────────────────────────────────

export async function getLlmConfig(): Promise<LlmConfig> {
  const cfg = await readConfig();
  const llm = cfg.llm ?? {
    enabled: false,
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini'
  };
  return { ...llm, hasApiKey: await hasApiKey() };
}

export async function setLlmConfig(
  patch: Partial<LlmConfig> & { apiKey?: string }
): Promise<LlmConfig> {
  const cfg = await readConfig();
  const cur = cfg.llm ?? {
    enabled: false,
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini'
  };
  const next: LlmConfig = {
    enabled: patch.enabled ?? cur.enabled,
    baseUrl: (patch.baseUrl ?? cur.baseUrl).trim() || 'https://api.openai.com/v1',
    model: (patch.model ?? cur.model).trim() || 'gpt-4o-mini'
  };
  if (patch.apiKey !== undefined) {
    if (patch.apiKey.trim() === '') {
      await deleteApiKey();
    } else {
      await saveApiKey(patch.apiKey.trim());
    }
  }
  await writeConfig({ ...cfg, llm: next });
  return { ...next, hasApiKey: await hasApiKey() };
}

// ─── Connection test ─────────────────────────────────────────────────────

export async function testConnection(): Promise<
  { ok: true; modelInfo?: string } | { ok: false; error: string }
> {
  const cfg = await getLlmConfig();
  if (!cfg.enabled) return { ok: false, error: 'AI 助手未启用' };
  const key = await loadApiKey();
  if (!key) return { ok: false, error: '未配置 API Key' };

  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        stream: false
      })
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 300)}` };
    }
    const j = (await res.json().catch(() => ({}))) as any;
    return { ok: true, modelInfo: j?.model ?? cfg.model };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

// ─── Prompt building ─────────────────────────────────────────────────────

function clip(s: string, cap: number): string {
  if (!s) return '';
  return s.length > cap ? s.slice(0, cap) + '…' : s;
}

function safeJson(v: unknown): string {
  try {
    return typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    return '';
  }
}

function summarizeToolUseInput(name: string, input: unknown): string {
  if (!input || typeof input !== 'object') return name;
  const i = input as Record<string, any>;
  switch (name) {
    case 'Bash':
      return `Bash: ${clip(String(i.command ?? ''), 160)}`;
    case 'Read':
    case 'Write':
    case 'Edit':
      return `${name}: ${i.file_path ?? ''}`;
    case 'Glob':
      return `Glob: ${i.pattern ?? ''}`;
    case 'Grep':
      return `Grep: ${i.pattern ?? ''}${i.glob ? ` glob=${i.glob}` : ''}`;
    case 'WebFetch':
    case 'WebSearch':
      return `${name}: ${i.url ?? i.query ?? ''}`;
    case 'Task':
      return `Task(subagent=${i.subagent_type ?? 'general'}): ${clip(String(i.description ?? i.prompt ?? ''), 120)}`;
    default:
      return `${name}: ${clip(safeJson(i), 160)}`;
  }
}

export function eventsToPrompt(events: NormEvent[]): string {
  const lines: string[] = [];
  for (const ev of events) {
    switch (ev.kind) {
      case 'user':
        if (ev.text) lines.push(`【用户】\n${clip(ev.text, PER_USER_ASSISTANT_CAP)}\n`);
        break;
      case 'assistant':
        if (ev.text) lines.push(`【助手】\n${clip(ev.text, PER_USER_ASSISTANT_CAP)}\n`);
        break;
      case 'thinking':
        if (ev.text) lines.push(`【助手 · 内心独白】\n${clip(ev.text, 1000)}\n`);
        break;
      case 'tool_use':
        lines.push(`[工具调用] ${summarizeToolUseInput(ev.name, ev.input)}`);
        break;
      case 'tool_result': {
        const tag = ev.isError ? '失败' : 'ok';
        lines.push(`[工具结果 · ${tag}] ${clip(ev.content ?? '', PER_TOOL_RESULT_CAP)}`);
        break;
      }
      default:
        // skip meta / unknown / parse_error
        break;
    }
  }
  return lines.join('\n');
}

/**
 * Truncate the *oldest* turns when total length exceeds budget. Keeps recent
 * context (which is what matters for continuation) intact.
 */
function truncatePromptIfNeeded(
  prompt: string,
  contextWindow: number
): { text: string; truncated: boolean; keptChars: number } {
  // Reserve room for system prompt + output. Budget ~70% for the conversation.
  const budgetChars = Math.floor(contextWindow * 0.7 * CHARS_PER_TOKEN);
  if (prompt.length <= budgetChars) {
    return { text: prompt, truncated: false, keptChars: prompt.length };
  }
  const kept = prompt.slice(prompt.length - budgetChars);
  // Snap to the next 【 boundary so we don't start mid-message
  const firstBoundary = kept.indexOf('\n【');
  const aligned = firstBoundary >= 0 ? kept.slice(firstBoundary + 1) : kept;
  const notice = `[注意：原对话过长，已截断前 ${prompt.length - aligned.length} 个字符，仅保留最近上下文]\n\n`;
  return { text: notice + aligned, truncated: true, keptChars: aligned.length };
}

// ─── Streaming summarize ─────────────────────────────────────────────────

function send(sender: WebContents, ev: LlmStreamEvent): void {
  if (sender.isDestroyed()) return;
  sender.send('llm:stream', ev);
}

export function newStreamId(): string {
  return randomBytes(8).toString('hex');
}

export function cancelStream(streamId: string): void {
  const c = activeStreams.get(streamId);
  if (c) c.abort();
  activeStreams.delete(streamId);
}

export async function summarizeSession(args: {
  streamId: string;
  sessionPath: string;
  sender: WebContents;
}): Promise<void> {
  const { streamId, sessionPath, sender } = args;
  const controller = new AbortController();
  activeStreams.set(streamId, controller);

  try {
    const cfg = await getLlmConfig();
    if (!cfg.enabled) throw new Error('AI 助手未启用，请在设置里开启');
    const key = await loadApiKey();
    if (!key) throw new Error('未配置 API Key，请在设置里填写');

    // Phase 1: read session
    const t1 = Date.now();
    send(sender, { type: 'phase', streamId, phase: 'reading', status: 'running' });
    const events = await readSession(sessionPath);
    send(sender, {
      type: 'phase',
      streamId,
      phase: 'reading',
      status: 'done',
      meta: { ms: Date.now() - t1, eventCount: events.length }
    });

    if (controller.signal.aborted) return;

    // Phase 2: prepare prompt
    const t2 = Date.now();
    send(sender, { type: 'phase', streamId, phase: 'preparing', status: 'running' });
    const raw = eventsToPrompt(events);
    const { text: promptText, truncated, keptChars } = truncatePromptIfNeeded(
      raw,
      DEFAULT_CONTEXT_WINDOW
    );
    const estTokens = Math.ceil(promptText.length / CHARS_PER_TOKEN);
    send(sender, {
      type: 'phase',
      streamId,
      phase: 'preparing',
      status: 'done',
      meta: {
        ms: Date.now() - t2,
        rawChars: raw.length,
        promptChars: promptText.length,
        keptChars,
        estTokens,
        truncated
      }
    });

    if (controller.signal.aborted) return;

    // Phase 3: stream LLM
    const t3 = Date.now();
    send(sender, {
      type: 'phase',
      streamId,
      phase: 'generating',
      status: 'running',
      meta: { model: cfg.model }
    });

    const url = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model: cfg.model,
        stream: true,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: promptText }
        ]
      })
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${errText.slice(0, 500)}`);
    }

    let fullText = '';
    let usage: { inputTokens?: number; outputTokens?: number } | undefined;

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';

    while (true) {
      if (controller.signal.aborted) {
        try {
          await reader.cancel();
        } catch {
          // ignore
        }
        return;
      }
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      // Parse SSE: split by double newline → each block contains data: lines
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (!line) continue;
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;
        let obj: any;
        try {
          obj = JSON.parse(payload);
        } catch {
          continue;
        }
        const delta = obj?.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) {
          fullText += delta;
          send(sender, { type: 'token', streamId, delta });
        }
        if (obj?.usage) {
          usage = {
            inputTokens: obj.usage.prompt_tokens ?? obj.usage.input_tokens,
            outputTokens: obj.usage.completion_tokens ?? obj.usage.output_tokens
          };
        }
      }
    }

    send(sender, {
      type: 'phase',
      streamId,
      phase: 'generating',
      status: 'done',
      meta: { ms: Date.now() - t3 }
    });
    send(sender, { type: 'done', streamId, fullText, usage });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      // user-initiated cancel: no error event
      return;
    }
    send(sender, { type: 'error', streamId, message: err?.message ?? String(err) });
  } finally {
    activeStreams.delete(streamId);
  }
}
