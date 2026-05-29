import { promises as fs } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { safeStorage, type WebContents } from 'electron';
import { LLM_KEY_FILE } from './paths';
import { readSession, type NormEvent } from './reader';
import { readConfig, writeConfig, type LlmConfig } from './store';

const SINGLE_SYSTEM_PROMPT = `你是一个对话压缩助手。把下面用户与助手的对话压缩成一份"续聊简报"，让接手的另一个 LLM 能从这里继续工作。

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

const REFINE_SYSTEM_PROMPT = `你正在维护一份长对话的"工作简报"——一份不断累积、被迭代更新的对话摘要。

我会给你：
1. [当前简报]：基于之前已读过的对话片段做出的累积摘要（首段时为空）
2. [新增对话片段]：刚刚读到的下一段对话

请合并它们，输出**更新后的工作简报**。要求：
- 保留[当前简报]里所有还有效的信息
- 把[新增片段]里的新决策、新文件、新待办、新主题并入
- 修正/更新过时的信息（例如：之前的待办现在已完成 → 移到"已完成"；之前的设计被推翻 → 标注更新）
- 总长度控制在 1000-2000 token
- 用 Markdown 列表组织（标题灵活，不强制最终结构）
- 保留具体名词（文件路径、函数名、技术栈、版本号）
- 直接输出新简报，不要前言`;

const FINALIZE_SYSTEM_PROMPT = `你拿到一份长对话的"工作简报"——它是基于完整对话逐段精炼得到的累积摘要。

请把它重新组织成最终的「续聊简报」，让接手的另一个 LLM 能从这里继续工作。

输出 Markdown，必须包含以下小节（## 标题）：
- 用户目标：1-2 句话
- 关键决策：列出已达成的设计 / 技术决定
- 当前状态：分「已完成 / 进行中 / 待办」三栏
- 涉及文件：路径 + 改动类型
- 下一步建议：接手者应该先做什么

要求：
- 总长度 800-1500 token
- 保留具体名词（文件路径、函数名、技术栈、版本号）
- **不要新增工作简报里没有的内容**，只做重组与提炼
- 不要解释你在做什么，直接输出简报`;

const SINGLE_SYSTEM_PROMPT_HTML = `你是一个对话压缩助手。把下面用户与助手的对话压缩成一份"续聊简报"，让接手的另一个 LLM 能从这里继续工作。

输出必须是**可直接嵌入网页的 HTML 片段**，包含以下小节：
- 用户目标：1-2 句话概括用户想做什么
- 关键决策：已达成的设计 / 技术决定
- 当前状态：分「已完成 / 进行中 / 待办」（建议用 <table> 或多个 <ul>）
- 涉及文件：路径 + 改动类型（新增 / 修改 / 删除），建议用 <table>
- 下一步建议：接手者应该先做什么

HTML 要求：
- 只输出片段，**不要** <html> / <head> / <body> / <!DOCTYPE> 外壳
- 用语义标签：<h2> 做小节标题，<ul>/<ol>/<li>、<table>/<thead>/<tbody>/<tr>/<th>/<td>、<p>、<code>、<strong>、<em>
- **严禁** <script>、<style>、内联事件（onclick 等）、外链资源（<img src>/<link>/<iframe>）、行内 style 属性
- 文件路径、函数名、版本号用 <code> 包裹
- 总长度 800-1500 token，简洁但具体
- 不要复述工具调用的原始输出，只保留关键结论
- 不要用 \`\`\`html 代码块包裹，不要任何前言，直接输出 HTML 片段`;

const FINALIZE_SYSTEM_PROMPT_HTML = `你拿到一份长对话的"工作简报"——它是基于完整对话逐段精炼得到的累积摘要。

请把它重新组织成最终的「续聊简报」，输出**可直接嵌入网页的 HTML 片段**，让接手的另一个 LLM 能从这里继续工作。

必须包含以下小节：
- 用户目标：1-2 句话
- 关键决策：已达成的设计 / 技术决定
- 当前状态：分「已完成 / 进行中 / 待办」（建议用 <table> 或多个 <ul>）
- 涉及文件：路径 + 改动类型，建议用 <table>
- 下一步建议：接手者应该先做什么

HTML 要求：
- 只输出片段，**不要** <html> / <head> / <body> / <!DOCTYPE> 外壳
- 用语义标签：<h2>、<ul>/<ol>/<li>、<table> 系列、<p>、<code>、<strong>、<em>
- **严禁** <script>、<style>、内联事件、外链资源、行内 style 属性
- 文件路径、函数名、版本号用 <code> 包裹
- 总长度 800-1500 token
- **不要新增工作简报里没有的内容**，只做重组与提炼
- 不要用 \`\`\`html 代码块包裹，不要任何前言，直接输出 HTML 片段`;

const PER_TOOL_RESULT_CAP = 400;
const PER_USER_ASSISTANT_CAP = 4000;
const DEFAULT_CONTEXT_WINDOW = 128_000;
// Rough heuristic: 1 token ≈ 3 chars for mixed CN/EN content.
const CHARS_PER_TOKEN = 3;
// Use at most this fraction of context window for input prompt (leaves room
// for system prompt + output).
const INPUT_BUDGET_RATIO = 0.6;

export type LlmStreamEvent =
  | {
      type: 'phase';
      streamId: string;
      phase: 'reading' | 'preparing' | 'refining' | 'generating';
      status: 'running' | 'done' | 'error';
      meta?: Record<string, unknown>;
    }
  | { type: 'token'; streamId: string; delta: string }
  | {
      type: 'done';
      streamId: string;
      fullText: string;
      format?: 'html' | 'markdown';
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

const FALLBACK_LLM: LlmConfig = {
  enabled: false,
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  contextWindow: DEFAULT_CONTEXT_WINDOW,
  summaryFormat: 'html'
};

export async function getLlmConfig(): Promise<LlmConfig> {
  const cfg = await readConfig();
  const llm = cfg.llm ?? FALLBACK_LLM;
  return {
    ...llm,
    contextWindow: llm.contextWindow > 0 ? llm.contextWindow : DEFAULT_CONTEXT_WINDOW,
    hasApiKey: await hasApiKey()
  };
}

export async function setLlmConfig(
  patch: Partial<LlmConfig> & { apiKey?: string }
): Promise<LlmConfig> {
  const cfg = await readConfig();
  const cur = cfg.llm ?? FALLBACK_LLM;
  const next: LlmConfig = {
    enabled: patch.enabled ?? cur.enabled,
    baseUrl: (patch.baseUrl ?? cur.baseUrl).trim() || 'https://api.openai.com/v1',
    model: (patch.model ?? cur.model).trim() || 'gpt-4o-mini',
    contextWindow:
      patch.contextWindow != null && patch.contextWindow > 0
        ? Math.floor(patch.contextWindow)
        : cur.contextWindow > 0
          ? cur.contextWindow
          : DEFAULT_CONTEXT_WINDOW,
    summaryFormat: patch.summaryFormat ?? cur.summaryFormat ?? 'html'
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
        'Content-Type': 'application/json; charset=utf-8',
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

/**
 * 净化字符串：去掉会让 OpenAI / Cloudflare 网关 JSON 解析失败的"脏"字符。
 *
 * - **孤立代理对**（lone surrogate）：会话内容里有时会出现孤立的高/低代理
 *   （来自损坏 emoji、被截断的终端输出、奇怪的控制序列）。`JSON.stringify`
 *   会把它编码成 `\uD8XX` 这种"语法合法但不是有效 Unicode"的转义，严格
 *   服务器会拒收，错误信息常表现为 "unexpected end of hex escape"。
 * - **非常用控制字符**（除 \n / \r / \t 外的 0x00-0x1F + 0x7F）：通常是
 *   终端控制序列残留，对 LLM 没有信息价值还可能触发解析异常。
 *
 * 用替换字符 � 替代孤立代理；控制字符直接丢掉。
 */
function sanitizeForApi(text: string): string {
  if (!text) return text;
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // Drop control chars except \t \n \r
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) continue;
    if (code === 0x7f) continue;
    // High surrogate: must be followed by low surrogate
    if (code >= 0xd800 && code <= 0xdbff) {
      if (i + 1 < text.length) {
        const next = text.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          out += text[i] + text[i + 1];
          i++;
          continue;
        }
      }
      out += '�';
      continue;
    }
    // Lone low surrogate
    if (code >= 0xdc00 && code <= 0xdfff) {
      out += '�';
      continue;
    }
    out += text[i];
  }
  return out;
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
 * Split prompt at message boundaries (the `【` markers). Each chunk stays
 * within `maxChars` when possible.
 *
 * **关键**：绝对不能在字符中间硬切。`eventsToPrompt` 已经把单条消息截到
 * 4000 字符以内，所以任意单段都不会超过常规 contextWindow 的预算。如果
 * 真出现某条超长消息超过 maxChars，把它单独放一块（即使超预算），不切。
 * 不然在中文 surrogate pair 中间切会导致落单的高位 surrogate，
 * JSON.stringify 后服务器拒收（`unexpected end of hex escape`）。
 */
export function splitByBoundary(prompt: string, maxChars: number): string[] {
  if (prompt.length <= maxChars) return [prompt];
  const parts = prompt.split(/(?=\n?【)/).filter((p) => p.length > 0);
  const chunks: string[] = [];
  let cur = '';
  for (const part of parts) {
    if (cur.length > 0 && cur.length + part.length > maxChars) {
      chunks.push(cur);
      cur = part;
    } else {
      cur += part;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
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

type CallArgs = {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userContent: string;
  abortSignal: AbortSignal;
  maxTokens?: number;
};

/**
 * Non-streaming LLM call. Returns the full content. Used in map phase.
 */
async function callLlmOnce(args: CallArgs): Promise<string> {
  const url = `${args.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    signal: args.abortSignal,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${args.apiKey}`
    },
    body: JSON.stringify({
      model: args.model,
      stream: false,
      max_tokens: args.maxTokens,
      messages: [
        { role: 'system', content: sanitizeForApi(args.systemPrompt) },
        { role: 'user', content: sanitizeForApi(args.userContent) }
      ]
    })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  const j = (await res.json()) as any;
  const content = j?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('LLM 返回格式异常（缺少 choices[0].message.content）');
  }
  return content;
}

/**
 * Streaming LLM call. Pushes each delta as a `token` event. Returns the
 * full accumulated text and usage info when done. Used in final/reduce phase.
 */
async function callLlmStreaming(
  args: CallArgs & { streamId: string; sender: WebContents }
): Promise<{ fullText: string; usage?: { inputTokens?: number; outputTokens?: number } }> {
  const url = `${args.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    signal: args.abortSignal,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${args.apiKey}`
    },
    body: JSON.stringify({
      model: args.model,
      stream: true,
      messages: [
        { role: 'system', content: sanitizeForApi(args.systemPrompt) },
        { role: 'user', content: sanitizeForApi(args.userContent) }
      ]
    })
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  }

  let fullText = '';
  let usage: { inputTokens?: number; outputTokens?: number } | undefined;
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';

  while (true) {
    if (args.abortSignal.aborted) {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
      return { fullText, usage };
    }
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (!line || !line.startsWith('data:')) continue;
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
        send(args.sender, { type: 'token', streamId: args.streamId, delta });
      }
      if (obj?.usage) {
        usage = {
          inputTokens: obj.usage.prompt_tokens ?? obj.usage.input_tokens,
          outputTokens: obj.usage.completion_tokens ?? obj.usage.output_tokens
        };
      }
    }
  }
  return { fullText, usage };
}

export async function summarizeSession(args: {
  streamId: string;
  sessionPath: string;
  sender: WebContents;
  format?: 'html' | 'markdown';
}): Promise<void> {
  const { streamId, sessionPath, sender } = args;
  const format = args.format ?? 'html';
  const controller = new AbortController();
  activeStreams.set(streamId, controller);

  try {
    const cfg = await getLlmConfig();
    if (!cfg.enabled) throw new Error('AI 助手未启用，请在设置里开启');
    const key = await loadApiKey();
    if (!key) throw new Error('未配置 API Key，请在设置里填写');

    const ctxWindow = cfg.contextWindow > 0 ? cfg.contextWindow : DEFAULT_CONTEXT_WINDOW;
    const maxCharsPerChunk = Math.floor(ctxWindow * INPUT_BUDGET_RATIO * CHARS_PER_TOKEN);

    // ── Phase 1: read session ──────────────────────────────────────────
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

    // ── Phase 2: prepare prompt + chunk planning ───────────────────────
    const t2 = Date.now();
    send(sender, { type: 'phase', streamId, phase: 'preparing', status: 'running' });
    const rawPrompt = eventsToPrompt(events);
    const chunks = splitByBoundary(rawPrompt, maxCharsPerChunk);
    const estTokens = Math.ceil(rawPrompt.length / CHARS_PER_TOKEN);
    send(sender, {
      type: 'phase',
      streamId,
      phase: 'preparing',
      status: 'done',
      meta: {
        ms: Date.now() - t2,
        rawChars: rawPrompt.length,
        estTokens,
        chunkCount: chunks.length,
        ctxWindow,
        maxCharsPerChunk
      }
    });
    if (controller.signal.aborted) return;

    let finalPromptForLlm: string;
    let finalSystem: string;

    if (chunks.length === 1) {
      // ── Single-chunk fast path: skip refine, go straight to streaming ──
      finalPromptForLlm = chunks[0];
      finalSystem = format === 'html' ? SINGLE_SYSTEM_PROMPT_HTML : SINGLE_SYSTEM_PROMPT;
    } else {
      // ── Phase 3: serial refine chain ─────────────────────────────────
      // 所有 N 段都走 refine，每一段都拿到之前累积的工作简报。
      // generating 阶段只做"重组结构化"，不再吃新 chunk 内容。
      // 这样 refining 的 done/total 与 preparing 报告的 chunkCount 完全
      // 一致（避免 "分 2 段处理但只看到 1/1" 的 UX 不一致）。
      const refineCount = chunks.length;
      const tRefine = Date.now();
      send(sender, {
        type: 'phase',
        streamId,
        phase: 'refining',
        status: 'running',
        meta: { done: 0, total: refineCount, model: cfg.model }
      });

      let workingBrief = '';
      for (let i = 0; i < refineCount; i++) {
        if (controller.signal.aborted) return;
        const isFirst = i === 0;
        const userContent = `[当前简报]\n${
          isFirst ? '（尚无简报，这是第 1 段）' : workingBrief
        }\n\n[新增对话片段 ${i + 1} / ${refineCount}]\n${chunks[i]}`;
        try {
          workingBrief = await callLlmOnce({
            baseUrl: cfg.baseUrl,
            apiKey: key,
            model: cfg.model,
            systemPrompt: REFINE_SYSTEM_PROMPT,
            userContent,
            abortSignal: controller.signal
          });
        } catch (err: any) {
          if (err?.name === 'AbortError') return;
          throw new Error(
            `第 ${i + 1} / ${refineCount} 段精炼失败：${err?.message ?? String(err)}`
          );
        }
        send(sender, {
          type: 'phase',
          streamId,
          phase: 'refining',
          status: 'running',
          meta: {
            done: i + 1,
            total: refineCount,
            model: cfg.model,
            briefChars: workingBrief.length
          }
        });
      }

      if (controller.signal.aborted) return;

      send(sender, {
        type: 'phase',
        streamId,
        phase: 'refining',
        status: 'done',
        meta: {
          ms: Date.now() - tRefine,
          done: refineCount,
          total: refineCount,
          briefChars: workingBrief.length
        }
      });

      // Final streaming pass: just restructure the accumulated brief into
      // the structured 续聊简报. No new content.
      finalPromptForLlm = `[工作简报]\n${workingBrief}`;
      finalSystem = format === 'html' ? FINALIZE_SYSTEM_PROMPT_HTML : FINALIZE_SYSTEM_PROMPT;
    }

    if (controller.signal.aborted) return;

    // ── Phase 4: generate (streaming output) ─────────────────────────
    const tGen = Date.now();
    send(sender, {
      type: 'phase',
      streamId,
      phase: 'generating',
      status: 'running',
      meta: {
        model: cfg.model,
        mode: chunks.length > 1 ? 'finalize' : 'single',
        chunkCount: chunks.length
      }
    });

    const { fullText, usage } = await callLlmStreaming({
      streamId,
      sender,
      baseUrl: cfg.baseUrl,
      apiKey: key,
      model: cfg.model,
      systemPrompt: finalSystem,
      userContent: finalPromptForLlm,
      abortSignal: controller.signal
    });

    if (controller.signal.aborted) return;

    send(sender, {
      type: 'phase',
      streamId,
      phase: 'generating',
      status: 'done',
      meta: { ms: Date.now() - tGen }
    });
    send(sender, { type: 'done', streamId, fullText, format, usage });
  } catch (err: any) {
    if (err?.name === 'AbortError') return;
    send(sender, { type: 'error', streamId, message: err?.message ?? String(err) });
  } finally {
    activeStreams.delete(streamId);
  }
}
