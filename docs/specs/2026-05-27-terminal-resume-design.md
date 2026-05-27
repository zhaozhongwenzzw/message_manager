# 在终端 Resume 会话 · 设计文档

> 在 Recall 的会话卡上加一个「在终端打开」按钮，点击后用 Claude Code / Codex CLI 直接 resume 那条会话，让用户**从"看历史"切换到"接着干"零摩擦**。

- **创建日期**：2026-05-27
- **状态**：待实现
- **作者**：Claude + 用户协作
- **依赖功能**：scanner 的 quickProbe（已能 probe 出 cwd）、settings 分区组件框架（已落地）

---

## 1 · 背景与目标

### 1.1 用户痛点

目前用户在 Recall 找到想接着干的历史会话后，只能：
1. 记下 session id 或项目目录
2. 自己开终端 `cd <项目>` 然后输 `claude --resume <id>` 或 `codex resume <id>`

每次至少 3-4 步切换上下文。重度用户每天可能 resume 几十次。

> **CLI 调用规范来源**：`claude --resume <session-id>` 见 `claude --help` 的 `-r, --resume [value]`；`codex resume <session-id>` 见 `codex resume --help`（接 SESSION_ID 作为 UUID）。两端的子命令风格不同，已在 §4.2.4 的 spawn 参数里写对。

### 1.2 目标

一键 resume：会话卡上加按钮，点击后**自动**：
- 检查工作目录存在
- 启动平台默认终端（Win Terminal / Terminal.app / gnome-terminal）
- 终端里 `cd` 到原 cwd
- 执行 `claude --resume <id>` 或 `codex resume <id>`

### 1.3 非目标

- **不**支持选择/配置自定义终端模拟器（如 WezTerm / Alacritty / iTerm）。本期只用平台默认；用户若有强烈需求，未来再扩展 `TerminalConfig` 加预设。
- **不**做"resume 时附带初始 prompt"。
- **不**对 cwd 不存在的会话做"挑个目录启动" 兜底。`cwd_missing` 直接报错。

### 1.4 设计原则

- **零配置可用**：不打开设置也能跑（用 PATH 里的 CLI + 平台默认终端）
- **失败即响**：能在主进程检查的（cwd / CLI 可执行）就提前检查，把错误归一为有意义的错误码，UI 翻译成中文 toast
- **跨平台模式分离**：Win/macOS/Linux 各自的 spawn 逻辑封装在 `terminal.ts` 内部，调用方完全不感知平台

---

## 2 · 架构概览

```
[SessionCard "Terminal" 按钮]
        │
        ▼  IPC: terminal:open  { source, sessionPath, cwd }
[src/main/terminal.ts · openInTerminal()]
        │
        ├─ guardCwd(cwd)                 → ok / cwd_not_set / cwd_missing
        ├─ resolveCli(source, cfg)       → 绝对路径 or 错误 cli_not_found
        ├─ resolveSessionId(source, ...) → UUID or 错误 session_id_invalid
        └─ spawnPlatformTerminal(cwd, [cliPath, 'resume', uuid])
                  │
                  ▼
        Win:   wt.exe -d <cwd> -- <cli> --resume <id>
               (fallback) cmd /c start "" /D <cwd> <cli> --resume <id>
        macOS: osascript -e 'tell app "Terminal" to do script "cd <cwd> && <cli> resume <id>"'
        Linux: gnome-terminal → konsole → xfce4-terminal → xterm，第一个能找到的
```

**主进程 spawn 后立刻 `unref()`**，子进程独立存活；渲染端 Promise 立即 resolve。

> Claude 用 `claude --resume <id>`（dash dash），Codex 用 `codex resume <id>`（子命令）。两者参数风格不同，已在 spawn 参数里写对。

---

## 3 · 数据模型

### 3.1 `src/main/store.ts`

```ts
/** 终端 / CLI 相关配置；本期只暴露 CLI 路径覆盖。 */
export type TerminalConfig = {
  /** Absolute path to claude CLI. Empty = look up "claude" on PATH. */
  claudePath?: string;
  /** Absolute path to codex CLI. Empty = look up "codex" on PATH. */
  codexPath?: string;
};

export type AppConfig = {
  // …existing fields…
  terminal?: TerminalConfig;
};
```

写入时取 `cfg.terminal ?? {}`，读时 `cfg.terminal?.claudePath?.trim() || undefined`，避免空串污染。

### 3.2 `src/main/scanner.ts` + `src/renderer/src/types.ts`

```ts
export type SessionSummary = {
  // …existing…
  cwd?: string; // probe 出的真实 cwd，没有就 undefined（按钮 disabled）
};
```

`quickProbe()` 已经在内部抓 `cwd`，只需让 `scanClaude` / `scanCodex` 把它带出来挂在 summary 上。**渲染端镜像类型同步更新**。

---

## 4 · 主进程模块 `src/main/terminal.ts`

### 4.1 公共接口

```ts
export type OpenTerminalArgs = {
  source: 'claude' | 'codex';
  sessionPath: string;   // 仅用于诊断信息
  sessionId: string;     // renderer 已规范化过的 UUID（见 4.3）
  cwd?: string;
};

export type OpenTerminalError =
  | { code: 'cwd_missing'; cwd: string }
  | { code: 'cwd_not_set' }
  | { code: 'cli_not_found'; cli: 'claude' | 'codex' }
  | { code: 'session_id_invalid'; raw: string }
  | { code: 'terminal_spawn_failed'; detail: string };

export type OpenTerminalResult =
  | { ok: true }
  | { ok: false; error: OpenTerminalError };

export async function openInTerminal(args: OpenTerminalArgs): Promise<OpenTerminalResult>;
```

> 注：虽然类型签名上 `sessionId` 是必填的，IPC 入口 `terminal:open` 接收的是 `sessionPath` 原始路径，主进程内做规范化后再调 `openInTerminal`。这样所有验证集中在主进程，避免渲染端被绕过。

### 4.2 内部职责（按调用顺序）

#### 4.2.1 CWD 校验

```ts
if (!cwd) return { ok: false, error: { code: 'cwd_not_set' } };
try {
  const stat = await fs.stat(cwd);
  if (!stat.isDirectory()) {
    return { ok: false, error: { code: 'cwd_missing', cwd } };
  }
} catch {
  return { ok: false, error: { code: 'cwd_missing', cwd } };
}
```

#### 4.2.2 CLI 可执行解析

```ts
async function resolveCli(source: 'claude' | 'codex'): Promise<string | null> {
  const cfg = await readConfig();
  const override = source === 'claude'
    ? cfg.terminal?.claudePath?.trim()
    : cfg.terminal?.codexPath?.trim();
  if (override) {
    // 验证存在 + 看起来像可执行
    if (!(await isExecutableFile(override))) return null;
    return override;
  }
  // PATH 查找
  return await whichOnPath(source);
}
```

**`isExecutableFile(path)`**：
- `fs.stat` 必须是 file（不是目录）
- Win：扩展名必须 ∈ `.exe / .cmd / .bat / .com / .ps1`（不能光靠 `X_OK`，Windows 上对普通文件也会返回 ok）
- mac/linux：`fs.access(path, X_OK)`

**`whichOnPath(name)`** 直接复用 npm 的 `which` 包（轻量、跨平台、处理 PATHEXT，避免自己造轮子）。找不到返回 null。

找不到 → `cli_not_found`。

#### 4.2.3 Session ID 规范化

```ts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_TAIL_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function resolveSessionId(source: 'claude' | 'codex', sessionPath: string): string | null {
  const base = path.basename(sessionPath).replace(/\.(jsonl|json)$/i, '');
  if (source === 'claude') {
    return UUID_RE.test(base) ? base : null;
  }
  // Codex: rollout-YYYY-MM-DDTHH-MM-SS-<uuid>，少数旧格式也可能直接是 uuid.jsonl
  const m = base.match(UUID_TAIL_RE);
  return m ? m[1] : null;
}
```

两端都用**严格 8-4-4-4-12 UUID 格式**，避免被任意 hex+dash 字符串绕过。抽不到 → `session_id_invalid`。

#### 4.2.4 平台 spawn

> 关键约束：spawn 的可执行必须是真正的 OS 可执行 — Windows 上 `.cmd`/`.bat` 不能被 `CreateProcess` 直接 spawn，必须用 `cmd.exe /c` 包装。这是 `claude`（npm 装的 `claude.cmd`）能不能跑起来的命门。

```ts
type SpawnRecipe = { cmd: string; args: string[] };

function buildResumeArgs(source: 'claude' | 'codex', id: string): string[] {
  return source === 'claude' ? ['--resume', id] : ['resume', id];
}

function wrapWinIfShim(cliPath: string, resumeArgs: string[]): string[] {
  // Windows: .cmd/.bat 需要 cmd.exe /c 包装；.exe 可以直接 spawn
  const ext = path.extname(cliPath).toLowerCase();
  if (ext === '.cmd' || ext === '.bat') {
    return ['cmd.exe', '/c', cliPath, ...resumeArgs];
  }
  return [cliPath, ...resumeArgs];
}

async function buildArgvWin(cliPath, source, cwd, id): Promise<SpawnRecipe | null> {
  const resume = buildResumeArgs(source, id);
  const cli = wrapWinIfShim(cliPath, resume); // 数组首项 = 实际可执行
  // 优先 Windows Terminal
  if (await hasOnPath('wt.exe')) {
    return { cmd: 'wt.exe', args: ['-d', cwd, '--', ...cli] };
  }
  // Fallback: cmd /c start —— start 走 ShellExecute，自动处理 .cmd/.bat，
  // 所以这里直接用原 cliPath 不需要包装。
  return { cmd: 'cmd.exe', args: ['/c', 'start', '""', '/D', cwd, cliPath, ...resume] };
}

function buildArgvMac(cliPath, source, cwd, id): SpawnRecipe {
  const resume = buildResumeArgs(source, id);
  // AppleScript 字符串转义：只需处理 \\ 和 \"
  const inner = `cd ${shellEscape(cwd)} && ${shellEscape(cliPath)} ${resume.map(shellEscape).join(' ')}`;
  const script = `tell application "Terminal" to do script "${appleScriptEscape(inner)}"`;
  return { cmd: 'osascript', args: ['-e', script] };
}

async function buildArgvLinux(cliPath, source, cwd, id): Promise<SpawnRecipe | null> {
  const resume = buildResumeArgs(source, id);
  const cliArgs = [cliPath, ...resume];
  const candidates: SpawnRecipe[] = [
    { cmd: 'gnome-terminal', args: ['--working-directory', cwd, '--', ...cliArgs] },
    { cmd: 'konsole',        args: ['--workdir', cwd, '-e', ...cliArgs] },
    { cmd: 'xfce4-terminal', args: [`--working-directory=${cwd}`, '-e',
                                     cliArgs.map(shellEscape).join(' ')] },
    { cmd: 'xterm',          args: ['-e',
                                     `cd ${shellEscape(cwd)} && ${cliArgs.map(shellEscape).join(' ')}`] }
  ];
  for (const c of candidates) if (await hasOnPath(c.cmd)) return c;
  return null;
}
```

**`appleScriptEscape(s)`**：`s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')`（**不**用 `JSON.stringify`，因为它会引入 `\uXXXX` 转义，AppleScript 不认）。

**`shellEscape(s)`**（POSIX）：`"'" + s.replace(/'/g, "'\\''") + "'"`。

**`hasOnPath(name)`** 同 4.2.2 的 `whichOnPath`，但只返回 bool。

#### 4.2.5 Spawn 执行 + 错误捕获

```ts
const recipe = await pickByPlatform(...);
if (!recipe) {
  return { ok: false, error: { code: 'terminal_spawn_failed',
                                detail: 'no terminal emulator found' } };
}

return new Promise((resolve) => {
  let child: ChildProcess;
  try {
    child = spawn(recipe.cmd, recipe.args, { detached: true, stdio: 'ignore' });
  } catch (e: any) {
    resolve({ ok: false, error: { code: 'terminal_spawn_failed',
                                   detail: e?.message ?? String(e) } });
    return;
  }

  // spawn() ENOENT 是异步抛的 'error' 事件；spawn 成功后会触发 'spawn'。
  // 我们要在两者之间做竞速，1 tick 内判定结果。
  let settled = false;
  const settle = (r: OpenTerminalResult): void => {
    if (settled) return;
    settled = true;
    resolve(r);
  };

  child.once('error', (err) => {
    console.warn('[terminal] spawn error:', err);
    settle({ ok: false, error: { code: 'terminal_spawn_failed',
                                  detail: err.message } });
  });
  child.once('spawn', () => {
    child.unref();
    settle({ ok: true });
  });

  // 兜底：某些异常情况下两个事件都不触发（实际不该发生；
  // Node child_process 一定会发其中一个）。1s 超时算成功，避免 IPC 挂死。
  setTimeout(() => settle({ ok: true }), 1000);
});
```

> 关键点：必须 `await` `'error'` vs `'spawn'` 的竞速。直接 try/catch 只能抓同步异常，`ENOENT`（wt.exe 不存在等）是异步发的，会被忽略。

### 4.3 IPC 入口

```ts
// src/main/ipc.ts
ipcMain.handle('terminal:open', async (_e, args: {
  source: 'claude' | 'codex';
  sessionPath: string;
  cwd?: string;
}): Promise<OpenTerminalResult> => {
  const sid = resolveSessionId(args.source, args.sessionPath);
  if (!sid) return { ok: false, error: { code: 'session_id_invalid', raw: args.sessionPath } };
  return openInTerminal({
    source: args.source,
    sessionPath: args.sessionPath,
    sessionId: sid,
    cwd: args.cwd
  });
});
```

### 4.4 Preload + Renderer API

```ts
// src/preload/index.ts
terminalOpen: (args: { source: 'claude' | 'codex'; sessionPath: string; cwd?: string }) =>
  ipcRenderer.invoke('terminal:open', args)

// src/renderer/src/api.ts
terminalOpen: (args) => window.api.terminalOpen(args) as Promise<OpenTerminalResult>
```

---

## 5 · UI 层

### 5.1 会话卡按钮

在 [SessionListItem.tsx](src/renderer/src/components/SessionListItem.tsx) 和 [SearchHitItem.tsx](src/renderer/src/components/SearchHitItem.tsx) 的悬停按钮区，**插在 Sparkles 之前**：

```
[Terminal] [Sparkles] [Archive(仅 codex)] [Star] [Trash]
```

- 图标：lucide `Terminal`
- 悬停色：`hover:bg-info-50 hover:text-info-600`（区分续聊简报的品牌色）
- `session.cwd` 为空时按钮 disabled + tooltip「会话未记录工作目录，无法 resume」

按钮的 `onClick` 调 `props.onOpenTerminal?.()`。两个卡片组件都同样接收 `onOpenTerminal?: () => void`。

### 5.2 [SessionList.tsx](src/renderer/src/components/SessionList.tsx)

新增 prop `onOpenTerminal?: (s: SessionSummary) => void`，透传给两个卡片组件。SearchHitItem 走"已知 session 优先，否则现场构造"的现有模式。

### 5.3 设置「终端」分区

新建 [settings/TerminalSection.tsx](src/renderer/src/components/settings/TerminalSection.tsx)，在 [settings/sections.tsx](src/renderer/src/components/settings/sections.tsx) 的 `SECTIONS` 注册：

```ts
{ key: 'terminal', label: '终端', desc: 'Claude / Codex CLI 路径', icon: <Terminal size={14} /> }
```

**配置读写路径决策**：复用 generic `config:get` / `config:set` IPC（终端配置就是 `AppConfig.terminal` 子字段），**不**新增 `terminalConfigSet` 专用 IPC。

- TerminalSection 内部自己 `api.getConfig()` 拿当前配置 + 局部 state（与 `LlmSection` 的模式不同：LlmSection 用了独立 IPC 是因为 API key 涉及 safeStorage 加密；终端配置只是路径字符串，没必要加这层）。
- `onBlur` patch：`await api.setConfig({ ...currentCfg, terminal: { ...currentCfg.terminal, claudePath: newVal } })`
- 终端配置**不**上提到 App.tsx state（不像 appearance / trashDir 需要驱动主视图渲染），完全闭包在 TerminalSection 内即可。

布局：

```
┌─ 终端 ──────────────────────────────────────────┐
│ Claude CLI 路径                                 │
│ [/usr/local/bin/claude        ] [选择]          │
│ 留空 = 使用 PATH 中的 "claude"                  │
│                                                 │
│ Codex CLI 路径                                  │
│ [                              ] [选择]          │
│ 留空 = 使用 PATH 中的 "codex"                   │
│                                                 │
│ ℹ 终端自动使用平台默认：Windows Terminal /      │
│   Terminal.app / gnome-terminal。              │
└─────────────────────────────────────────────────┘
```

「选择」按钮调一个新 IPC `dialog:pick-file`（参考 [ipc.ts](src/main/ipc.ts) 现有 `dialog:pick-folder`，行 ~147，差异只在 `properties: ['openFile']` 而不是 `['openDirectory']`）打开原生文件选择器。

### 5.4 错误反馈（[App.tsx](src/renderer/src/App.tsx)）

```ts
const onOpenTerminal = useCallback(async (s: SessionSummary) => {
  const res = await api.terminalOpen({
    source: s.source,
    sessionPath: s.path,
    cwd: s.cwd
  });
  if (!res.ok) setError(translateTerminalError(res.error));
}, []);
```

错误文案（util `translateTerminalError`）：

| code | 文案 |
| --- | --- |
| `cwd_not_set` | 该会话未记录工作目录，无法 resume |
| `cwd_missing` | 原工作目录已不存在：{cwd}，无法 resume |
| `cli_not_found` | 找不到 {claude\|codex} 命令，请在设置 → 终端中填写路径 |
| `session_id_invalid` | 无法解析会话 ID（{raw}） |
| `terminal_spawn_failed` | 启动终端失败：{detail} |

复用顶栏现有的 `error` banner（`setError(msg)` 已支持）。

---

## 6 · 错误处理 & 兼容

### 6.1 边界情况

| 场景 | 行为 |
| --- | --- |
| 会话 `cwd` 为空（probe 没抓到） | 按钮 disabled |
| `cwd` 在当前机器不存在（仓库被删） | 提交时按下，主进程返回 `cwd_missing`，UI toast |
| CLI 在 PATH 中找不到，且未配置覆盖 | 主进程返回 `cli_not_found`，文案带"请去设置填路径" |
| 用户配置的 CLI 路径无效 | 同上，`cli_not_found` |
| Linux 上没装任何探测列表里的终端 | `terminal_spawn_failed`，提示『未找到可用终端模拟器』 |
| Codex 文件名旧格式不含 UUID | `session_id_invalid` |
| Codex 会话已归档（在 `archived_sessions/` 下） | 仍可启动，命令一样能 resume（Codex CLI 不区分归档目录） |

### 6.2 安全

- spawn 用 `shell: false` + argv 数组，避免命令注入
- AppleScript / xterm `-e` 字符串里调 `shellEscape` 包裹路径
- session id 必须通过 UUID regex 校验后才进 spawn
- CLI 路径若用户配置，调用前 `fs.access(..., X_OK)`

### 6.3 跨平台终端 spawn 后的进程关系

所有平台都用 `spawn(..., { detached: true, stdio: 'ignore' }).unref()`，确保 Recall app 关闭不会拖死子终端窗口。

---

## 7 · 测试策略

### 7.1 单元测试（`src/main/__tests__/terminal.test.ts`）

- `resolveSessionId` — 样例：
  - Claude 标准：`019d0386-4c45-7ee2-9367-d319b65dc616.jsonl` → ok
  - Claude 非法：`session1.jsonl` / `abc.jsonl` / 空 → null
  - Codex 标准：`rollout-2026-03-19T00-37-32-019d0386-4c45-7ee2-9367-d319b65dc616.jsonl` → 抽出末尾 UUID
  - Codex 直 UUID 旧格式：`019d0386-4c45-7ee2-9367-d319b65dc616.json` → 抽出（兼容性）
  - 文件名末尾不是 UUID：`rollout-corrupt.jsonl` → null
- `buildArgvWin` / `buildArgvMac` / `buildArgvLinux` — snapshot 测试，验证 argv 数组结构；mock `hasOnPath` 返回值覆盖：
  - Win：`wt` 存在 → wt recipe；`wt` 不存在 → cmd /c start fallback
  - Win：`cliPath` 是 `.cmd` → 走 `wrapWinIfShim` 加 `cmd.exe /c`；`.exe` → 直接 spawn
  - Linux：四个终端按顺序探测，第一个命中即返回
- `wrapWinIfShim` — `.cmd` / `.bat` / `.exe` / 无扩展 4 个 case
- `appleScriptEscape` — 含 `"` / `\\` / 中文 / 含空格的路径
- `shellEscape`（POSIX）— 路径含空格 / 中文 / `'` / `$` / 反斜杠
- `isExecutableFile` — 跨平台分别 mock：Win 的扩展名白名单 / mac 的 X_OK

### 7.2 不写的测试

- 真实终端 spawn 集成测试 —— 依赖宿主 OS，CI 跑不稳。手测覆盖。

### 7.3 手测路径（v0.3.3 发布前）

1. **Win + Claude 路径正常**：选一条 Claude 会话 → 点 Terminal → 确认 Win Terminal 弹出 + `claude --resume <id>` 跑通进入对话
2. **Win + 没装 wt**：临时改名 `wt.exe` → 应 fallback 到 `cmd /c start` 弹 cmd 窗口
3. **Codex 普通会话**：同测，确认 `codex resume <uuid>` 命中
4. **Codex 归档会话**：归档一条 → 点 Terminal → 应能正常 resume（CLI 不区分目录）
5. **cwd 不存在**：临时删一个项目目录 → 点 Terminal → 应 toast『原工作目录已不存在』
6. **PATH 没 claude**：临时把 PATH 里的 claude 移走 → 点 → toast『找不到 claude…请去设置填路径』
7. **配置假路径**：设置里填 `/tmp/nope/claude` → 点 → 同样的 cli_not_found
8. **清空所有配置**：恢复默认，验证仍可启动

---

## 8 · 文件清单

| 文件 | 改动类型 |
| --- | --- |
| `src/main/terminal.ts` | 新建 |
| `src/main/__tests__/terminal.test.ts` | 新建 |
| `src/main/scanner.ts` | 改：`SessionSummary` 加 `cwd?`，scan* 函数把 cwd 带出来 |
| `src/main/store.ts` | 改：`AppConfig` 加 `terminal?: TerminalConfig` |
| `src/main/ipc.ts` | 改：注册 `terminal:open` + `dialog:pick-file` |
| `src/preload/index.ts` | 改：暴露 `terminalOpen` + `pickFile` |
| `src/renderer/src/api.ts` | 改：typed 包装 |
| `src/renderer/src/types.ts` | 改：镜像 `SessionSummary.cwd` + `TerminalConfig` + `OpenTerminalResult/Error` |
| `src/renderer/src/components/SessionListItem.tsx` | 改：加 Terminal 按钮 + disabled 态 |
| `src/renderer/src/components/SearchHitItem.tsx` | 改：同上 |
| `src/renderer/src/components/SessionList.tsx` | 改：透传 `onOpenTerminal` prop |
| `src/renderer/src/components/SettingsDialog.tsx` | 改：active 分支加 `terminal` |
| `src/renderer/src/components/settings/sections.tsx` | 改：注册 terminal 项 |
| `src/renderer/src/components/settings/TerminalSection.tsx` | 新建 |
| `src/renderer/src/App.tsx` | 改：`onOpenTerminal` handler + 透传给 SessionList |
| `src/renderer/src/utils/terminalError.ts` | 新建：错误码 → 中文文案 |
| `docs/modules.md` | 改：补 terminal.ts 模块说明 + 新增 IPC |
| `docs/specs/2026-05-27-terminal-resume-design.md` | 本文档（已存在） |
| `package.json` | 改：加 `which` 依赖（npm package，运行时跨平台 PATH 查找） |

## 9 · 验证

1. `npm run typecheck` 全过
2. `npm test` 跑通新增的 `terminal.test.ts`
3. 手测 7.3 全 8 个场景
4. `npm run build` 通过
5. 视情况 bump 到 v0.3.3 + `release:win`

---

## 10 · 未来扩展点（YAGNI 的对照清单）

> 本期不做，但留 hook：

- **自定义终端选择**：扩展 `TerminalConfig` 为 `{ preset: 'auto'|'wt'|'cmd'|'wezterm'|'iterm'|'terminal-app'|... ; customCommand?: string }`，主进程加 spawn 预设
- **Resume 时附带 prompt**：UI 加个文本框 → 命令变 `claude --resume <id> "<prompt>"`
- **跨 cwd resume**：cwd 不存在时弹目录选择器
- **快捷键绑定**：会话选中状态下按 `t` 打开终端
- **路径含 `;` 的处理**：Windows Terminal 用 `;` 作命令分隔符，理论上 `wt -d <cwd>` 在 cwd 含 `;` 时会被错误切分。真实项目路径几乎不会出现；如果未来要严格化，可在 `buildArgvWin` 里对 cwd 加 `\;` 转义
- **强制新窗口（macOS）**：当前 AppleScript `do script` 复用 Terminal.app 当前窗口；想要"每次新窗口"可改成 `do script "..." in (make new window)`
