# AI 压缩续聊简报设计文档（v0.3）

> 作者：assistant · 日期：2026-05-24 · 状态：**待审阅**
> 目标版本：Recall v0.3.0

---

## 1. 目标

把任意会话压缩成一份 1-3k token 的"续聊简报"，让用户能直接粘到另一个 LLM（Claude Code / Codex / Cursor / GPT 等）里**接着干**，而不是从头解释一遍。

**核心需求（用户明确）**：
- **Agent 形态**：分步骤执行，弹窗里能看到当前在干啥
- **流式输出**：压缩文本边生成边显示，不要傻等
- **OpenAI 兼容接口**：用户填 baseURL + key + model，谁的模型都能用
- **Key 加密**：用 Electron safeStorage 走 OS 密钥链
- **先简单后优化**：v0.3 跑通最小闭环，后续加 prompt 模板、批量、历史记录

---

## 2. Agent 执行流程

弹窗里展示 3 步时间线（每步有 pending / running / done / error 四态）：

```
┌─ 续聊简报 · 项目名称 ──────────────────── × ┐
│                                              │
│  ① ✓ 读取会话                  (220 ms)       │
│      78 条消息 · 142 KB                       │
│                                              │
│  ② ✓ 整理上下文                 (45 ms)        │
│      去除元数据 + 折叠工具调用                  │
│      → 给 LLM 的 prompt：约 12,400 token       │
│                                              │
│  ③ ⏳ 生成简报                  (3.2 s · 流式) │
│      ┌────────────────────────────────────┐  │
│      │ # 续聊简报                          │  │
│      │                                    │  │
│      │ ## 用户目标                         │  │
│      │ 给 Recall 加全文搜索功能...          │  │
│      │ ▌                                  │  │
│      └────────────────────────────────────┘  │
│                                              │
│   [取消]              [复制] [保存] [重新生成] │
└──────────────────────────────────────────────┘
```

每步对应代码里一个 `phase`，主进程通过 `webContents.send('llm:stream', event)` 推事件给渲染端。

---

## 3. 数据模型

### 3.1 LLM 配置（新增到 `AppConfig`）

```ts
type LlmConfig = {
  enabled: boolean;
  baseUrl: string;     // 默认 'https://api.openai.com/v1'
  // API key 不存在 config.json 里，单独走 safeStorage
  model: string;       // 默认 'gpt-4o-mini'，用户可改
  // 是否已经存过 key（用于 UI 显示「已配置」徽章）
  hasApiKey: boolean;
};
```

key 实际加密存到 `~/.claude-manager/llm-key.enc`（二进制文件，safeStorage 输出）。
读取时用 `safeStorage.decryptString(buf)` 拿回明文。

### 3.2 流式事件协议

```ts
type LlmStreamEvent =
  | { type: 'phase'; streamId: string; phase: 'reading' | 'preparing' | 'generating'; status: 'running' | 'done' | 'error'; meta?: Record<string, unknown> }
  | { type: 'token'; streamId: string; delta: string }
  | { type: 'done'; streamId: string; fullText: string; usage?: { inputTokens: number; outputTokens: number } }
  | { type: 'error'; streamId: string; message: string };
```

`streamId` 用于多实例区分（防止用户同时压缩两个会话时事件串台）。

---

## 4. 主进程改动

### 4.1 新建 `src/main/llm.ts`

```ts
export async function summarizeSession(args: {
  streamId: string;
  sessionPath: string;
  abortSignal: AbortSignal;
  sender: WebContents;
}): Promise<void>;

// 内部：
// 1) phase=reading → readSession() → push event
// 2) phase=preparing → eventsToPrompt(events) → 给 LLM 的输入文本 → push token count
// 3) phase=generating → fetch baseUrl/chat/completions stream → 按 SSE 解析 → 每个 delta push token event
// 4) done event with full text + usage

function eventsToPrompt(events: NormEvent[]): string {
  // 机械整理：
  // - 跳过 meta / unknown / parse_error
  // - user / assistant / thinking → 原文（thinking 加前缀「内心独白」）
  // - tool_use → 一行摘要 `[工具: Bash · cmd=npm test]`
  // - tool_result → 一行摘要 `[结果: ok · 142 字]` 或错误信息
  // 然后整体拼成一长串纯文本
}

const SYSTEM_PROMPT = `你是一个对话压缩助手。把下面用户与助手的对话压缩成续聊简报。

输出必须包含以下小节（用 ## 标题）：
- 用户目标：1-2 句话
- 关键决策：列出已达成的设计/技术决定
- 当前状态：分「已完成 / 进行中 / 待办」
- 涉及文件：路径 + 改动类型
- 下一步建议：接手者应该先做什么

要求：
- 总长度 800-1500 token
- 保留具体名词（文件路径、函数名、技术栈）
- 不要复述工具调用的原始输出，只保留关键结论`;
```

### 4.2 IPC 通道

| 通道 | 入参 | 出参 | 说明 |
| --- | --- | --- | --- |
| `llm:config:get` | — | `LlmConfig` | 不返回 key 明文 |
| `llm:config:set` | `Partial<LlmConfig> + apiKey?: string` | `LlmConfig` | apiKey 非空时加密落盘；空字符串视为"清除" |
| `llm:test-connection` | — | `{ ok: true; modelInfo? } \| { ok: false; error: string }` | 用当前 config 试调 `/models` 或 `/chat/completions` 探活 |
| `llm:summarize:start` | `{ sessionPath: string }` | `{ streamId: string }` | 起一个流式任务 |
| `llm:summarize:cancel` | `{ streamId: string }` | `void` | abort 对应任务 |
| 推送：`llm:stream` | `LlmStreamEvent` | — | webContents.send 推送 |

主进程维护 `activeStreams: Map<string, AbortController>`，cancel 时调对应 abort。

### 4.3 安全：仅在主进程持有 key

- 渲染端**永远拿不到 key 明文**。`llm:config:get` 只返回 `hasApiKey: boolean`。
- 渲染端调 `llm:summarize:start`，主进程内部读 key → 加 header → 发请求。
- 渲染端调 `llm:test-connection`，同样在主进程内完成实际网络请求。

### 4.4 网络层

直接用 Node 18+ 的 `fetch` + `ReadableStream`。OpenAI SSE 协议：
```
data: {"choices":[{"delta":{"content":"# "}}]}
data: {"choices":[{"delta":{"content":"续聊简报"}}]}
data: [DONE]
```
按行解析，对每个 `data:` JSON 提取 `choices[0].delta.content`，push 给渲染端。

---

## 5. 渲染端改动

### 5.1 类型 & API

`types.ts` 加 `LlmConfig` / `LlmStreamEvent` / `LlmTestResult`。
`api.ts` 加 `llmConfigGet / llmConfigSet / llmTestConnection / llmSummarizeStart / llmSummarizeCancel / onLlmStream(cb)`。

### 5.2 新建 `src/renderer/src/components/SummarizeDialog.tsx`

- props: `{ open: boolean; session: SessionSummary | null; onOpenChange(open) }`
- 内部状态：`phases: PhaseState[]`、`output: string`、`done: boolean`、`error: string | null`、`streamId: string | null`
- 打开时若 `LlmConfig.enabled === false || !hasApiKey` → 显示「请先配置 API Key」 + 按钮跳转到设置
- 调 `api.llmSummarizeStart({ sessionPath })` 拿 streamId，订阅 `onLlmStream` 累积事件
- 关闭弹窗时调 `llmSummarizeCancel(streamId)` 防止资源泄漏
- 按钮：
  - 「取消」：进行中显示，调 cancel
  - 「复制」：done 后显示，`navigator.clipboard.writeText(output)`
  - 「保存」：调 `api.pickFolder` 拿目录，或用 Electron `showSaveDialog`（新加 IPC）写 `.md`
  - 「重新生成」：done / error 后显示，重起一个 streamId

### 5.3 设置弹窗加「AI 助手」分区

[SettingsDialog.tsx](../../src/renderer/src/components/SettingsDialog.tsx) 新增 section：
- Toggle：启用 / 禁用
- Base URL 输入框（默认 `https://api.openai.com/v1`）
- API Key 输入框（password，已配置时显示 `••••••••` + 「修改」按钮）
- Model 输入框（默认 `gpt-4o-mini`）
- 「测试连接」按钮 → 显示成功/失败状态
- 提示：「Key 通过系统密钥链加密存储，不会同步到任何外部服务」

### 5.4 入口：列表卡片悬停按钮

[SessionListItem.tsx](../../src/renderer/src/components/SessionListItem.tsx) 在收藏 / 删除按钮之间加一个 `Wand2` 图标按钮，悬停时露出，点击触发 `onSummarize(session)`，App.tsx 接住后打开 `SummarizeDialog`。

注：搜索结果卡片 `SearchHitItem.tsx` 同步加（保持一致性）。

---

## 6. 边界 & 风险

| 风险 | 应对 |
| --- | --- |
| 用户填的 baseUrl 是恶意端点 | 网络请求只发"用户已知的对话内容"，没有额外敏感数据。文档明示风险。 |
| 单次会话超 LLM 上下文窗口 | `eventsToPrompt` 输出 > 80% of limit 时截断尾部 + 加提示「保留最近 N 轮」。窗口大小按 model 表硬编一份兜底 32k。 |
| key 在 safeStorage 不可用时 | 降级到明文 + 醒目警告 banner |
| LLM 中途超时/断流 | 渲染端 30 秒无新 token → 显示「连接超时，重试」按钮，调 cancel 后重起 |
| 用户同时打开多个 SummarizeDialog | streamId 区分；每个 dialog 只听自己的 streamId 事件 |
| OpenAI 兼容端点不完全兼容 SSE 格式 | 错误时显示原始响应前 500 字，方便用户排查 |

---

## 7. 任务拆解

| Step | 内容 | 预估 |
| --- | --- | --- |
| 1 | 主进程：`llm.ts` 含 `eventsToPrompt` + safeStorage key 读写 + fetch SSE 解析 | 0.5 天 |
| 2 | IPC + preload + api typed 包装 | 0.2 天 |
| 3 | SettingsDialog 加 AI 分区 + 测试连接 | 0.3 天 |
| 4 | `SummarizeDialog` 组件（3 步时间线 + 流式输出区 + 三按钮） | 0.5 天 |
| 5 | 入口：列表卡片 + 搜索结果卡片悬停按钮；App.tsx 串通 | 0.2 天 |
| 6 | 边界打磨（上下文超长、超时重试、安全降级） | 0.3 天 |
| 7 | 更新 `docs/modules.md` + 发版 | 0.2 天 |
| **合计** | | **~2.2 天** |

---

## 8. 验证清单

1. 设置里填 OpenAI key → 测试连接成功
2. 点列表卡片「续聊简报」 → 弹窗 3 步顺序点亮 → 流式输出到底
3. 复制按钮 → 剪贴板拿到完整 markdown
4. 保存按钮 → 文件管理器选位置 → 写出 .md
5. 重新生成按钮 → 起新 stream，不残留旧内容
6. 关闭弹窗 → 主进程 abortController 被触发，没有继续扣费
7. 故意填错 baseUrl → 错误信息可读
8. 切换到 DeepSeek 兼容端点（`https://api.deepseek.com/v1` + `deepseek-chat`）→ 走通
9. 关掉应用、重启 → key 仍能解密
10. Key 加密文件被手动删除 → 提示重新配置

---

## 9. v0.3 不做的（留给 v0.4+）

- 自定义 prompt 模板（让用户改 system prompt）
- 历史压缩记录（每次结果存进 `~/.claude-manager/summaries/`）
- 批量压缩 + 并发限制
- 直接喂 Claude/Codex 而不只是导出（需要写另一个工具的 session 文件）
- 多步 agent（先抽取实体 → 再分类 → 再生成简报，目前是单 LLM 调用 + 时间线视觉）

---

## 10. 待你确认

请在每条后用 ✅ / ❌ + 备注回复，或直接说"按文档来"：

1. **第 3 步是"单次 LLM 调用 + 流式显示"，不是真的多 agent**。视觉上是 3 步时间线（reading / preparing / generating），但只调一次 LLM。是否接受？_推荐接受，v0.3 简单。后续真要拆多步再扩。_✅
2. **默认 model 填 `gpt-4o-mini`**（OpenAI 兼容场景下最广泛）。是否换成空字符串让用户必填？_推荐保留默认值，UI 上提示「可改」。_✅
3. **入口只放列表卡片悬停按钮**（你之前选的）。要不要 DetailDrawer 顶部也加一个？_推荐两个都加（成本低），便利性翻倍。_ 只加列表里面
4. **保存为 .md 走 Electron showSaveDialog**（原生），还是用浏览器的 `showSaveFilePicker`？_推荐 Electron showSaveDialog，桌面应用更顺手。_✅
5. **超长会话**：超过 80% 上下文窗口时**截断尾部保留最近 N 轮**，还是**拒绝并提示用户**？_推荐截断 + 明显提示，比挡门好用。_✅

审阅完成后我开始 Step 1。
