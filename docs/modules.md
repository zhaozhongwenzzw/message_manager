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

### `limit.ts` — 并发限制器
12 行自实现的 `pLimit(concurrency)`，避免引入 ESM-only 的 `p-limit`。用于 scanner 限制并发 fs 读取。

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
`scanClaude / scanCodex / readSession / deleteSession / deleteClaudeProject / listStars / toggleStar / getConfig / setConfig / openTrash / openAppData / revealPath / pickFolder / trashDefaultPath / updaterStatus / updaterCheck / updaterDownload / updaterInstall / onUpdaterStatus`。
其中 `onUpdaterStatus(cb)` 是订阅模式，返回 `() => removeListener`。

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
渲染端共享类型：`Source`、`SessionSummary`、`ClaudeProject`、`NormEvent`、`AppConfig`、`Appearance`、`UpdaterStatus`、`UpdateInfoLite`、`UpdateProgress`。

### `styles.css`
Tailwind base + 自定义 CSS 变量（白/暗主题切换、`bg-canvas/surface/surface-sub`、`text-ink-*`、`bg-brand-*` 等品牌色调色板）、`.markdown` 排版、`.dialog-popup/.dialog-overlay/.dialog-drawer` 动画。

### 组件 `components/`

| 组件 | 职责 |
| --- | --- |
| **`Header.tsx`** | 顶栏：Logo + Claude/Codex Tab 切换 + 计数徽章 + `<UpdateIndicator>` + 重新扫描按钮 + 打开回收站按钮。 |
| **`ProjectSidebar.tsx`** | 左侧侧栏：「全部」+ 按项目（Claude）或按月份（Codex）分组；每行带计数；Claude 模式悬停出现「删除项目」；底部「设置」按钮。 |
| **`SessionList.tsx`** | 中间会话列表：搜索框（预览/项目/会话 ID 模糊）、「仅看收藏」过滤、底栏会话数；用 `SessionListItem` 渲染每条。 |
| **`SessionListItem.tsx`** | 单条会话卡片：项目首字母色块头像、相对时间、预览、消息数、字节数、ID 前 8 位；悬停露出收藏/删除。 |
| **`DetailDrawer.tsx`** | 右侧抽屉（可全屏）：调 `api.readSession(path)` 拿 `NormEvent[]`，顶栏统计 user/assistant/tool/thinking 数；元数据可隐藏；事件 >30 条时启用 `@tanstack/react-virtual` 虚拟列表。 |
| **`EventRenderer.tsx`** | 把单个 `NormEvent` 渲染成统一卡片：`UserMessage`（蓝）/`AssistantMessage`（品牌色）/`Thinking`（灰斜体）/`ToolUse`（黄+图标 + 可展开完整输入）/`SubAgentCall`（紫，强调，Task 工具专用）/`ToolResult`（成功灰/失败红，>800 字可折叠）/`Meta` & `UnknownEvent`（`<details>` 收纳原始 JSON）。Markdown 走 `react-markdown` + `remark-gfm` + `rehype-highlight`。 |
| **`SettingsDialog.tsx`** | 设置弹窗：外观主题（浅/深/跟随系统，每个选项带迷你预览）+ 回收站路径（显示当前路径、修改、打开、恢复默认；非法路径会被 main 端拒绝并展示红条）。 |
| **`UpdateIndicator.tsx`** | Header 上的更新指示器 + 弹窗。订阅 `updater:status`，按 phase 切换图标/文案/动作按钮：`available` 显示「跳过此版本」+「下载更新」；`downloading` 显示进度条；`downloaded` 显示「立即重启并安装」；`pending-publish` 显示「重试下载」；同版本被「跳过」后下次启动不再自动弹窗（但 Header 图标常驻可手动打开）。 |
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
- 扫描只读首行 + 首条用户消息做预览，不建索引（v1 范围）。
- 任何破坏性操作（删除会话 / 删除项目 / 下载更新 / 安装更新）都必须用户在 UI 上点击确认。
- UI 走白色简约风：白卡片、圆角、品牌色绿、浅 hover、lucide-react 图标，禁用 emoji；不同事件类型用色彩 + 图标 + 卡片层级清晰区分（用户=蓝、助手=品牌、工具=黄、子代理=紫、思考=灰、错误=红）。
- 偏好用第三方无样式基元 (Radix UI) + Tailwind 自包装，避免 Mantine/Ant Design 这种重型 UI 库。
