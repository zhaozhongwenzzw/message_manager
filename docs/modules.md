# Recall · 模块说明

> Recall 是一个本地 Electron 桌面应用，统一管理 **Claude Code**（`~/.claude/projects/`）和 **Codex**（`~/.codex/sessions/` + `archived_sessions/`）的对话历史：浏览、搜索、按项目/月份归类、收藏、软删除到回收站、详情查看（含工具调用 / 子代理 / 思考过程）。
>
> 技术栈：Electron + electron-vite + React 18 + TypeScript + Tailwind + Radix UI + lucide-react。

---

## 数据存放位置

应用自身**绝不污染源目录**。所有写操作都落在 `~/.claude-manager/` 下：

| 路径 | 说明 |
| --- | --- |
| `~/.claude-manager/` | 应用数据根目录（`APP_DATA_DIR`） |
| `~/.claude-manager/config.json` | 用户配置（外观、回收站路径、活动 tab、窗口尺寸…） |
| `~/.claude-manager/metadata.json` | 收藏数据（`{ stars: { 绝对路径: true } }`） |
| `~/.claude-manager/trash/` | 默认回收站，可在「设置」改为其他绝对路径 |
| `~/.claude-manager/trash/claude/...` | Claude 软删除的会话（保留原相对路径） |
| `~/.claude-manager/trash/claude/__projects/<key>` | 整个 Claude 项目被删除时的归档目录 |
| `~/.claude-manager/trash/codex/...` 或 `.../archived/...` | Codex 软删除的会话 |
| `~/.claude-manager/search-index.json` | MiniSearch 序列化的全文索引（事件级），删了会自动重建 |
| `~/.claude-manager/search-manifest.json` | 索引清单：会话路径 → size/eventCount，用于增量索引判断 |
| `~/.claude-manager/llm-key.enc` | AI 助手 API Key（safeStorage 加密；仅本机可解） |

只读源目录：`~/.claude/projects/`、`~/.codex/sessions/`、`~/.codex/archived_sessions/`。

---

## 进程结构

```
┌────────────────────────────┐         IPC          ┌────────────────────────────┐
│   主进程 (src/main)        │  ◀──────────────▶   │ 渲染进程 (src/renderer)    │
│  - Electron BrowserWindow  │      preload         │  - React UI                │
│  - 文件 IO / 扫描 / 更新   │  bridge (window.api) │  - 通过 window.api 调主进程│
└────────────────────────────┘                      └────────────────────────────┘
```

中间通过 `src/preload/index.ts` 用 `contextBridge` 在 `contextIsolation` 下暴露安全 API。

---

## 主进程（`src/main/`）

### `index.ts` — Electron 应用入口
- `app.whenReady()` 时：设置 Windows AppUserModelID（让任务栏图标正常）、`ensureAppDirs()`、`registerIpc()`、读取 `windowBounds` 创建 `BrowserWindow`。
- 窗口 `ready-to-show` 后**仅在打包模式下**动态 import `./updater` 并 `initUpdater(mainWindow)`（dev 模式跳过，避免 `electron-updater` 在开发环境报错）。
- 拦截 `setWindowOpenHandler` 把 `target=_blank` 链接交给系统浏览器。
- 关窗时把 `getBounds()` 写回 `config.json`，下次启动恢复尺寸/位置。
- 渲染端 `console-message` / `did-fail-load` / `render-process-gone` 都 forward 到主进程 stdout，方便调试。

### `ipc.ts` — IPC 通道注册
统一在 `registerIpc()` 里挂 `ipcMain.handle(...)`。完整通道列表：

| 通道 | 作用 |
| --- | --- |
| `scan:claude` | 扫描 `~/.claude/projects/`，返回 `ClaudeProject[]` |
| `scan:codex` | 扫描 `~/.codex/sessions` + `archived_sessions`，返回 `SessionSummary[]` |
| `read:session` `{ path }` | 读完整会话文件并规范化成 `NormEvent[]` |
| `delete:session` `{ source, path }` | 软删除单个会话到回收站 |
| `delete:claude-project` `{ projectKey }` | 软删除整个 Claude 项目 |
| `star:list` | 拉所有收藏 |
| `star:toggle` `{ path, starred }` | 切换收藏 |
| `config:get` / `config:set` | 读写 `config.json` |
| `open:trash` | 系统文件管理器打开回收站 |
| `open:app-data` | 打开 `~/.claude-manager/` |
| `path:reveal` `{ path }` | 在文件管理器中显示任意路径 |
| `dialog:pick-folder` `{ defaultPath, title }` | 弹原生文件夹选择器（拒绝源目录） |
| `trash:default-path` | 返回 `DEFAULT_TRASH_DIR` |
| `trash:list` | 列举回收站内所有项目（会话 + 整个项目目录），返回 `TrashEntry[]` |
| `trash:restore` `{ trashPath, mode? }` | 把项目恢复到原位置；冲突时返回 `{ conflict: true, originalPath }` 等待 UI 给出 `overwrite` / `rename` |
| `trash:purge` `{ trashPath }` | 从回收站彻底删除一个项目（递归） |
| `trash:empty` | 清空回收站 `<trashRoot>/{claude,codex}/*` |
| `search:query` `{ query, source? }` | 全文搜索：返回 `SearchHit[]`（事件级命中按会话聚合，按相关度排序）|
| `search:status` | 当前索引状态（已索引会话数、事件总数、是否正在构建、上次构建时间）|
| `search:rebuild` | 强制重建：先重扫 Claude/Codex，再清空索引并全量重索引 |
| `llm:config:get` | 返回 `LlmConfig`（含 `hasApiKey: boolean`，**不返回 key 明文**） |
| `llm:config:set` `Partial<LlmConfig> & { apiKey? }` | 更新 LLM 配置；`apiKey` 非空时调 safeStorage 加密落盘，空串视为清除 |
| `llm:test-connection` | 用当前 config 对 `/chat/completions` 发一次 max_tokens=1 ping，返回 `{ ok, modelInfo? } \| { ok: false, error }` |
| `llm:summarize:start` `{ sessionPath }` | 起一个流式压缩任务，返回 `{ streamId }`；事件经 `llm:stream` 推送 |
| `llm:summarize:cancel` `{ streamId }` | 调对应 AbortController 取消请求 |
| `dialog:save-file` `{ defaultPath, title, content, filters? }` | 弹原生保存对话框 + 写文件，返回 `{ path }` 或 `null` |
| `updater:status` / `updater:check` / `updater:download` / `updater:install` | 自动更新（懒加载 `./updater`） |

`updater` 模块用 `await import('./updater')` 懒加载，避免 dev 启动崩溃。

### `scanner.ts` — 历史会话扫描
- `scanClaude()`：遍历 `~/.claude/projects/*/*.jsonl`，并发上限 8。每个文件用 `quickProbe()` 流式读首行——尽早提取首条 `user` 消息预览、首个 `cwd`、首个 `timestamp` 后立即 `break`，避免一次性 JSON.parse 整个大文件。
- `scanCodex()`：递归遍历 `~/.codex/sessions/` 和 `archived_sessions/`，按 `YYYY-MM` 分组 `projectKey`。
- `projectLabel` 优先用真实 `cwd` 的尾段（`shortLabel`），无 cwd 时回退到 `decodeClaudeProjectName()`（Claude 用 `D--custorm-message-manager` 这种编码记录路径）。
- `messageCount` 当流式读早期 break 后用 `size/250` 估算。

### `reader.ts` — 会话事件规范化
`readSession(filePath)` 逐行解析 JSONL，把 Claude 和 Codex 两种形态映射到统一的 `NormEvent`：
- `user` / `assistant` / `thinking`：纯文本消息
- `tool_use`：工具调用（带 `name` + `input`）
- `tool_result`：工具结果（带 `isError`）
- `meta`：`session_meta` / `permission-mode` / `file-history-snapshot` 等元信息
- `unknown` / `parse_error`：兜底，避免单行损坏打断整个会话

支持的 Codex `payload.type`：`message` / `reasoning` / `function_call` / `tool_call` / `local_shell_call` / `function_call_output` 及对应 output。

### `deleter.ts` — 软删除
- `softDelete(source, srcPath, trashRoot)`：把源文件 `rename` 到 `<trashRoot>/<source>/<相对路径>`。
- 路径越界校验：拒绝 `..` 出现在相对路径中。
- 冲突回避：目标已存在则追加 ISO 时间戳后缀。
- `softDeleteClaudeProject(projectKey, trashRoot)`：把整个 Claude 项目目录搬到 `<trashRoot>/claude/__projects/<key>`，先用白名单校验 `projectKey` 不含分隔符。

### `store.ts` — 配置 + 元数据持久化
- `ensureAppDirs()`：建 `APP_DATA_DIR` 和 `DEFAULT_TRASH_DIR`。
- `readConfig()` / `writeConfig()`：`AppConfig`，含 `activeTab`、`windowBounds`、`showStarredOnly`、`appearance`、`trashDir`，缺省值 `DEFAULT_CONFIG`。
- `readMetadata()` / `writeMetadata()`：`{ stars }`。
- `writeJsonAtomic()`：写临时文件 `*.tmp` → `rename` 替换，**Windows EPERM 时重试 5 次**（杀软/索引可能持锁）。每个文件维护写队列防止并发竞争。

### `paths.ts` — 路径常量
导出 `HOME`、`CLAUDE_PROJECTS_DIR`、`CODEX_SESSIONS_DIR`、`CODEX_ARCHIVED_DIR`、`APP_DATA_DIR`、`DEFAULT_TRASH_DIR`、`METADATA_FILE`、`CONFIG_FILE`。还提供：
- `decodeClaudeProjectName(folderName)`：把 Claude 的 `D--custorm-message-manager` 反推回 `D:\custorm\message_manager`（有损，仅作显示回退）。
- `shortLabel(cwd)`：取路径最后一段做项目标签。

### `star.ts` — 收藏管理
基于 `store.readMetadata/writeMetadata` 的轻薄包装，模块内缓存一份 `Metadata`。提供 `listStars()` / `toggleStar(path, starred)` / `clearStar(path)`（软删除时调用，同时去除收藏）。

### `trash.ts` — 回收站管理
- `listTrash(trashRoot)`：递归扫 `<trashRoot>/{claude,codex}/`，对每个会话文件用 `scanner.quickProbe` 复用同一套预览/cwd 提取逻辑；`claude/__projects/<key>` 子树作为 `kind: 'project'` 单独枚举，统计 childCount + 总大小。返回 `TrashEntry[]`，按 `deletedAt` 倒序。
- `restoreFromTrash(trashRoot, { trashPath, mode? })`：把 trashPath 反推回原始位置（CLAUDE_PROJECTS_DIR / CODEX_SESSIONS_DIR / CODEX_ARCHIVED_DIR / `__projects` → 项目目录）后 `fs.rename`。原位置已存在时：`mode` 未传 → 返回 `{ conflict: true, originalPath }` 给 UI；`mode='overwrite'` → 删现有再 rename；`mode='rename'` → 在文件名/目录名末尾追加 `.restored.<ISO>` 后 rename。带路径越界校验。
- `purgeFromTrash(trashRoot, trashPath)`：彻底删除回收站里的某项；先验证 `trashPath` 必须在 `trashRoot` 内。
- `emptyTrash(trashRoot)`：清空 `<trashRoot>/{claude,codex}/` 下所有子项，保留这两个父目录。

### `limit.ts` — 并发限制器
12 行自实现的 `pLimit(concurrency)`，避免引入 ESM-only 的 `p-limit`。用于 scanner 限制并发 fs 读取。

### `search.ts` — 全文搜索索引
- 基于 [MiniSearch](https://lucaong.github.io/minisearch/) 的纯 JS 倒排索引，零原生依赖。
- **分词策略**：英文 / 数字按 `\W+` 拆词；中文 / CJK 用 **bigram**（"回收站管理" → `["回收","收站","站管","管理"]`），单字也保留。`tokenize` 同时给写入和查询用。MiniSearch 配 `prefix: true` + `combineWith: 'AND'`，多关键词同时命中才算分。
- **索引粒度**：一条 doc = 一个 `NormEvent`（`${sessionPath}#${index}` 作主键）；不索引 `meta` / `unknown` / `parse_error`；`user` / `assistant` / `thinking` 截到 2000 字，`tool_use` / `tool_result` 截到 500 字（工具输出常常是几千行日志，召回价值低）。
- **权重**：`user`/`assistant` × 2.0，`thinking` × 1.0，`tool_use`/`tool_result` × 0.5；`projectLabel` 字段 boost 1.5。
- **增量同步**：`syncSearchIndex(SyncInput[])` 拿当前扫描结果对比 `search-manifest.json`，按 `(path, size, projectKey, projectLabel)` 判断是否需要重索引，多余的从索引移除。`scan:claude` / `scan:codex` 处理器异步触发（不阻塞 UI 首屏）；两个 source 都至少同步过一次后才合并写索引，避免任一 source 单独触发导致另一边被清空。
- **持久化**：debounce 5s 的 `schedulePersist()`；`window-all-closed` 时 `flushSearchPersist()` 立即落盘。schema `MANIFEST_VERSION` 不匹配时 init 阶段直接丢弃旧索引，下次 scan 自动重建。
- **查询接口**：`search(query, { source?, limit, perSessionLimit })` 把 MiniSearch 的事件级命中按 `sessionPath` 聚合成 `SearchHit[]`，每会话保留至多 5 条命中事件 + excerpt（关键词前后 50/90 字），按 `bestScore` 降序。
- **删除联动**：`delete:session` 处理器调 `removeSessionFromIndex(filePath)` 顺手清掉相关 docs，避免索引出现 dangling 项。

### `llm.ts` — AI 助手（续聊简报）
- **目标**：把一条会话压缩成 800-1500 token 的 Markdown 简报，让用户粘到其他 LLM 接着干。
- **OpenAI 兼容接口**：用户在设置里填 `baseUrl` + `model` + API Key，支持 OpenAI / DeepSeek / Moonshot / Ollama 等任何走 `/v1/chat/completions` SSE 协议的端点。
- **API Key 安全**：通过 `safeStorage.encryptString` 加密落盘到 `~/.claude-manager/llm-key.enc`，调 OS 密钥链（Windows DPAPI / macOS Keychain / Linux libsecret）。渲染端**永远拿不到明文**，所有网络请求都在主进程发起。
- **三阶段 agent 视觉**：
  1. `reading` — `readSession()` 拿 `NormEvent[]`
  2. `preparing` — `eventsToPrompt()` 机械整理成纯文本（meta / unknown / parse_error 全跳；tool_use 折成一行摘要；tool_result 截到 400 字；user/assistant/thinking 截到 4000/4000/1000 字）
  3. `generating` — fetch SSE 流，逐 delta 通过 `webContents.send('llm:stream', ...)` 推渲染端
  > v0.3 只调一次 LLM，视觉上是 3 步；真正拆多 agent 留给 v0.4+。
- **上下文超长**：prompt 估算 token > 上下文窗口 70% 时**截尾保留最近内容**，并在 phase meta 里带 `truncated: true` 提示 UI 显示。默认窗口 128k。
- **取消**：每个任务对应一个 `AbortController`，关弹窗 / 点取消时 `controller.abort()`。
- **错误**：HTTP 非 2xx 时把响应前 500 字塞进 error event，便于排查（典型场景：baseUrl 拼错、key 失效、model 不存在）。

### `updater.ts` — 自动更新
基于 `electron-updater` + GitHub Releases (`zhaozhongwenzzw/message_manager`)。

- **`autoDownload = false`**：所有下载必须用户在 UI 上确认才会触发。
- **启动立即检查**：`initUpdater()` 装好窗口后立刻 `checkForUpdates({ silent: true })`，之后每小时一次。
- 把 `electron-updater` 的事件（`checking-for-update`/`update-available`/`update-not-available`/`download-progress`/`update-downloaded`/`error`）翻译为内部 `UpdaterStatus` discriminated union 并 `webContents.send('updater:status', state)` 推给渲染端。
- 错误特殊处理：GitHub 404（latest.yml 已发布但安装包还在传）→ `pending-publish`，文案提示「过几分钟再试」。
- 对外 API：`getStatus()` / `checkForUpdates()` / `downloadUpdate()` / `quitAndInstall()` / `disposeUpdater()`。

---

## Preload Bridge（`src/preload/`）

### `index.ts`
用 `contextBridge.exposeInMainWorld('api', api)` 把 IPC 包装成 `window.api`：
`scanClaude / scanCodex / readSession / deleteSession / deleteClaudeProject / listStars / toggleStar / getConfig / setConfig / openTrash / openAppData / revealPath / pickFolder / trashDefaultPath / trashList / trashRestore / trashPurge / trashEmpty / searchQuery / searchStatus / searchRebuild / llmConfigGet / llmConfigSet / llmTestConnection / llmSummarizeStart / llmSummarizeCancel / onLlmStream / saveFile / updaterStatus / updaterCheck / updaterDownload / updaterInstall / onUpdaterStatus`。
其中 `onUpdaterStatus(cb)` / `onLlmStream(cb)` 是订阅模式，返回 `() => removeListener`。

### `index.d.ts`
仅声明 `window.api` 的全局类型，让渲染端 TS 能识别。

---

## 渲染进程（`src/renderer/src/`）

### `main.tsx`
React 入口。包一层 `ErrorBoundary` 兜底渲染错误，再包 `ConfirmProvider` 提供全局 `useConfirm()`，最后挂 `<App />`。

### `App.tsx` — 主框架
- 顶层状态：`tab` (claude/codex)、`scan` (扫描结果 + stars)、`query`、`starredOnly`、`selectedProjectKey`、`openSession`、`appearance`、`trashDir`、`settingsOpen`。
- 启动时 `api.getConfig()` 恢复偏好，再 `refresh()` 同时跑 `scanClaude / scanCodex / listStars`。
- 任何偏好变更都自动 `api.setConfig({...})` 持久化。
- `useEffect` 给 `<html>` 设 `data-theme=tab`（Claude 橙色 / Codex 蓝色）和 `data-appearance=light|dark`（含 `matchMedia` 跟随系统）。
- 软删除/项目删除均通过 `useConfirm()` 弹原生风格确认对话框。

### `api.ts`
对 `window.api` 的 typed 包装；若 preload bridge 缺失（路径错配）会返回 Proxy 抛友好错误而不是 `undefined`。

### `types.ts`
渲染端共享类型：`Source`、`SessionSummary`、`ClaudeProject`、`NormEvent`、`AppConfig`、`Appearance`、`UpdaterStatus`、`UpdateInfoLite`、`UpdateProgress`、`TrashEntry`、`RestoreResult`、`SearchHit`、`SearchMatch`、`SearchStatus`、`LlmConfig`、`LlmTestResult`、`LlmStreamEvent`。

### `styles.css`
Tailwind base + 自定义 CSS 变量（白/暗主题切换、`bg-canvas/surface/surface-sub`、`text-ink-*`、`bg-brand-*` 等品牌色调色板）、`.markdown` 排版、`.dialog-popup/.dialog-overlay/.dialog-drawer` 动画。

### 组件 `components/`

| 组件 | 职责 |
| --- | --- |
| **`Header.tsx`** | 顶栏：Logo + Claude/Codex Tab 切换 + 计数徽章 + `<UpdateIndicator>` + 重新扫描按钮 + 打开回收站按钮。 |
| **`ProjectSidebar.tsx`** | 左侧侧栏：「全部」+ 按项目（Claude）或按月份（Codex）分组；每行带计数；Claude 模式悬停出现「删除项目」；底部「设置」按钮。 |
| **`SessionList.tsx`** | 中间会话列表：搜索框 + 「仅看收藏」过滤。无查询时按当前 tab 渲染 `SessionListItem`；有查询（≥ 2 字）时切换到 `SearchHitItem` 渲染主进程返回的 `SearchHit[]`，状态条显示「N 个会话命中」。 |
| **`SessionListItem.tsx`** | 单条会话卡片：项目首字母色块头像、相对时间、预览、消息数、字节数、ID 前 8 位；悬停露出**续聊简报（Sparkles）/ 收藏 / 删除**三个按钮。 |
| **`SearchHitItem.tsx`** | 全文搜索结果卡片：与会话卡同构，但 preview 区换成最多 3 条命中事件（按 kind 着色的小图标 + `<mark>` 高亮的 excerpt） + 「N 处命中」徽章；点击带上首个命中事件 index 传给 `DetailDrawer`；悬停同样有续聊简报按钮。 |
| **`DetailDrawer.tsx`** | 右侧抽屉（可全屏）：调 `api.readSession(path)` 拿 `NormEvent[]`，顶栏统计 user/assistant/tool/thinking 数；元数据可隐藏；事件 >30 条时启用 `@tanstack/react-virtual` 虚拟列表。打开搜索结果时携带 `jumpToEvent` + `highlightQuery`：滚动到对应事件并播放 `.search-hit-target` ring 动画；同时给 user/assistant/thinking 切到纯文本 + 高亮模式（牺牲 markdown 换准确高亮），tool_result 的 `<pre>` 直接 `highlightTerms`。 |
| **`EventRenderer.tsx`** | 把单个 `NormEvent` 渲染成统一卡片：`UserMessage`（蓝）/`AssistantMessage`（品牌色）/`Thinking`（灰斜体）/`ToolUse`（黄+图标 + 可展开完整输入）/`SubAgentCall`（紫，强调，Task 工具专用）/`ToolResult`（成功灰/失败红，>800 字可折叠）/`Meta` & `UnknownEvent`（`<details>` 收纳原始 JSON）。Markdown 走 `react-markdown` + `remark-gfm` + `rehype-highlight`。 |
| **`SettingsDialog.tsx`** | 设置弹窗：外观主题（浅/深/跟随系统，每个选项带迷你预览）+ 回收站路径（显示当前路径、修改、打开、恢复默认；非法路径会被 main 端拒绝并展示红条）+ **搜索索引**（显示已索引会话数 / 事件数 / 上次构建时间，构建中时显示进度 + spinner，「重建索引」按钮带 confirm）+ **AI 助手**（启用 toggle、Base URL、Model、API Key 输入/掩码显示/清除、测试连接按钮 + 结果横条；key 通过 safeStorage 加密）。 |
| **`SummarizeDialog.tsx`** | AI 续聊简报弹窗。打开时拉 `llmConfigGet`，未配置则提示跳设置；否则调 `llm:summarize:start` 拿 streamId，订阅 `llm:stream` 累积事件。顶部 3 步时间线（读取 / 整理 / 生成）每步带耗时 + meta（事件数、prompt token 数 / 是否截断、模型名）；中部纯文本 pre 流式输出 + 闪烁光标；底部按钮：取消（运行中）/ 重新生成 / 保存为 .md（走原生 `dialog:save-file`）/ 复制（带 1.5s 已复制提示）。关闭即调 cancel 阻止扣费。 |
| **`UpdateIndicator.tsx`** | Header 上的更新指示器 + 弹窗。订阅 `updater:status`，按 phase 切换图标/文案/动作按钮：`available` 显示「跳过此版本」+「下载更新」；`downloading` 显示进度条；`downloaded` 显示「立即重启并安装」；`pending-publish` 显示「重试下载」；同版本被「跳过」后下次启动不再自动弹窗（但 Header 图标常驻可手动打开）。 |
| **`TrashView.tsx`** | 整页回收站视图（覆盖主视图区域）。顶部工具栏含返回 / 计数 / 在文件管理器中打开 / 刷新 / 清空回收站；左侧筛选「全部 / Claude / Codex / 整个项目」；中间搜索框 + 列表 + 多选状态下浮出的批量操作栏（恢复 / 彻底删除 / 取消选择）；内联 `ConflictDialog` 负责恢复冲突时三选项弹窗（覆盖 / 重命名 / 取消），批量恢复时第一次选择会自动应用到剩余项。 |
| **`TrashListItem.tsx`** | 单条回收项卡片：左侧 checkbox + 头像色块（项目用 Folder 紫色，会话用首字母随机色）；标题 + 类型徽章（整个项目 / Claude / Codex）+ 删除时间；副信息显示预览/路径/大小/消息数；右侧 「恢复」「彻底删除」按钮。 |
| **`ConfirmDialog.tsx`** | `ConfirmProvider` + `useConfirm()`：组件树任意位置调 `await confirm({ title, description, confirmLabel, tone })` 返回 `Promise<boolean>`。tone 控制 danger（红删除按钮）/brand（绿色确认按钮）。 |

---

## 自动更新流程（更新于 2026-05-23）

> 用户的核心要求：**不许在用户没点确认的情况下下载或安装任何东西**。

1. 应用启动后立刻在后台 `checkForUpdates()`（之后每小时一次）。
2. 检查到新版本 → 主进程推 `phase: 'available'` → 渲染端 `UpdateIndicator` 自动弹窗（首次出现该版本时）。
3. 用户两个选择：
   - **下载更新** → IPC `updater:download` → `autoUpdater.downloadUpdate()` 开始下载，进度通过 `download-progress` 事件实时推给渲染端进度条。
   - **跳过此版本** → 记到 `dismissedVersion` state，下次启动若仍是同版本就不自动弹窗（用户可主动点 Header 图标重新打开）。
4. 下载完成 → `phase: 'downloaded'` → 弹窗显示「立即重启并安装」。点击后 `autoUpdater.quitAndInstall(false, true)` 退出并静默运行 NSIS 安装器。
5. 若不立即重启，下次正常退出应用时会因 `autoInstallOnAppQuit = true` 自动安装。
6. GitHub 404（draft 还没上传完 / latest.yml 在但安装包不在）→ `phase: 'pending-publish'`，UI 显示「重试下载」按钮，用户可主动重试。

发版命令见 [auto-update.md](auto-update.md)。

---

## 设计原则速查

- 数据写入只发生在 `~/.claude-manager/`；源目录全只读。
- 扫描只读首行 + 首条用户消息做预览。全文搜索按需建立事件级倒排索引（MiniSearch + bigram），增量同步、可重建。
- 任何破坏性操作（删除会话 / 删除项目 / 下载更新 / 安装更新）都必须用户在 UI 上点击确认。
- UI 走白色简约风：白卡片、圆角、品牌色绿、浅 hover、lucide-react 图标，禁用 emoji；不同事件类型用色彩 + 图标 + 卡片层级清晰区分（用户=蓝、助手=品牌、工具=黄、子代理=紫、思考=灰、错误=红）。
- 偏好用第三方无样式基元 (Radix UI) + Tailwind 自包装，避免 Mantine/Ant Design 这种重型 UI 库。
