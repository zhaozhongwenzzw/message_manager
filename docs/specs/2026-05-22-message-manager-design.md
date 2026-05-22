# Message Manager 设计文档

> 创建日期：2026-05-22
> 状态：已批准（用户授权自主推进）

## 1. 目标

一个本地桌面应用，统一管理 Claude Code 和 Codex 的历史会话。功能：浏览 / 按项目+日期+关键词过滤 / 查看会话详情（含工具调用）/ 加星收藏 / 软删除到回收站。

不修改源会话文件，只读 + 移动。

## 2. 数据来源

### 2.1 Claude Code

- 会话目录：`~/.claude/projects/{编码后的项目路径}/{session-uuid}.jsonl`
- 项目路径编码规则（实测）：盘符冒号 → `--`，反斜杠/正斜杠 → `-`，示例 `D:\custorm\message_manager` → `D--custorm-message-manager`
- 每个 JSONL 文件 = 一次会话；每行是一个事件
- 事件类型：
  - `type:"permission-mode"` — 元数据（跳过显示）
  - `type:"file-history-snapshot"` — 元数据（跳过显示）
  - `type:"user"` — 用户消息，内容在 `message.content`（字符串或 content blocks 数组）
  - `type:"assistant"` — 助手消息，同上
  - `type:"tool_use"`、`type:"tool_result"` — 工具调用
  - 其他都按"未知事件"折叠显示
- 项目真实路径优先从事件的 `cwd` 字段取（更准），目录名解码作为兜底

### 2.2 Codex

- 活跃会话：`~/.codex/sessions/{YYYY}/{MM}/{DD}/rollout-{ISO时间戳}-{uuid}.jsonl`
- 归档会话：`~/.codex/archived_sessions/{id}.json`（当前为空目录，预留处理但不必硬适配）
- 事件结构：
  - 第一行通常是 `type:"session_meta"`，`payload.cwd` 是工作目录，`payload.timestamp` 是起始时间
  - 用户和助手消息结构与 Claude 略不同，需要做适配层

### 2.3 应用自己的数据

目录：`~/.claude-manager/`（与源数据隔离，绝不污染原始目录）

```
~/.claude-manager/
├── trash/
│   ├── claude/{原编码目录名}/{文件名}.jsonl
│   └── codex/{原相对路径}/{文件名}.jsonl
├── metadata.json     # 星标、自定义备注，键是绝对路径
└── config.json       # 窗口大小、当前 tab、过滤条件
```

## 3. 架构

### 3.1 技术栈

- Electron 31+
- electron-vite（脚手架 + 构建）
- React 18 + TypeScript
- Tailwind CSS（样式）
- `react-markdown` + `remark-gfm` + `rehype-highlight`（渲染消息中的 Markdown 和代码块）

### 3.2 进程划分

```
main 进程（Node.js）
├── scanner — 扫源目录，返回会话列表（每个会话只读首行+首条用户消息，控制并发）
├── reader  — 读单个会话完整 JSONL，转换为统一事件结构返回
├── deleter — 软删除：把源文件移动到 ~/.claude-manager/trash/...
├── star    — 星标 metadata 读写
├── paths   — 项目路径解码与规范化
└── ipc     — 注册所有 IPC handler

preload 进程
└── contextBridge.exposeInMainWorld('api', { ... }) — 把 main 的能力安全暴露给 renderer

renderer 进程（React）
├── TabSwitch       — Claude/Codex 顶部 Tab
├── ProjectSidebar  — 项目列表（仅 Claude 有；Codex tab 显示按日期分组）
├── SessionList     — 中间会话列表，含搜索框、加星过滤
├── SessionListItem — 单条会话项：预览 + 时间 + 工具调用次数 + 星标 + 删除按钮
├── DetailDrawer    — 右侧抽屉/全屏看会话详情
└── EventRenderer   — 渲染单条事件（user/assistant/tool_use/tool_result/未知）
```

### 3.3 IPC 接口

| channel | 入参 | 出参 | 说明 |
|---|---|---|---|
| `scan:claude` | — | `Project[]`（含每项目下会话摘要） | 扫 ~/.claude/projects/ |
| `scan:codex`  | — | `CodexSession[]` | 扫 ~/.codex/sessions/ + archived |
| `read:session` | `{ source, path }` | `Event[]` | 读完整 JSONL |
| `delete:session` | `{ source, path }` | `{ ok, trashPath }` | 软删除 |
| `star:toggle` | `{ path, starred }` | `{ ok }` | 切换星标 |
| `star:list` | — | `{ [path]: true }` | 取所有星标 |
| `config:get` / `config:set` | key/value | … | 持久化设置 |

## 4. 关键数据流

### 4.1 启动 / 切 Tab

1. renderer 调 `scan:claude` 或 `scan:codex`
2. main 用 `fs.readdir` 列出会话文件
3. 对每个文件并发开 `readline`，只读到第一条 `type:"user"` 事件就关闭流，提取预览（前 80 字符）和时间戳
4. 同时统计文件大小、最后修改时间
5. 一次性返回数组给 renderer

并发用 `p-limit(8)`，避免一次性打开几百个文件句柄。

### 4.2 看详情

1. 用户点击列表项
2. renderer 调 `read:session`
3. main 读整个 JSONL，逐行 parse，按统一结构 normalize（不同源转成同一种 Event）
4. 返回 `Event[]`，renderer 用 EventRenderer 渲染

### 4.3 软删除

1. 用户点删除 → 二次确认
2. renderer 调 `delete:session`
3. main 计算 trash 目标路径，递归创建目录，`fs.rename` 移动文件
4. 同名冲突时追加 `.{timestamp}` 后缀
5. 返回成功后 renderer 从列表里乐观移除

### 4.4 加星

1. metadata.json 用绝对路径作 key，`{ starred: true }` 作 value
2. star:toggle 直接读写 metadata.json（加写锁防并发）

## 5. 边界情况

- **JSONL 损坏行**：parse 失败的行包装成 `{ type: 'parse-error', rawLine: '...' }`，UI 显示为灰色折叠块，不中断渲染
- **超大会话**（10MB+）：用流式 parse；UI 用虚拟滚动（react-window）
- **首条消息预览读取失败**：fallback 到文件名 + mtime
- **archived_sessions 单文件 .json 格式未知**：扫描时先尝试 `JSON.parse`，能解析就当一个会话，不能就跳过并 console.warn
- **同名文件**：UUID 全局唯一，理论上不会冲突；trash 同名冲突走时间戳后缀
- **路径含特殊字符**：所有路径操作走 `path.join` / `path.resolve`，不手拼字符串

## 6. UI 布局（已敲定方案 A）

```
┌─────────────────────────────────────────────────┐
│ [Claude Code] [Codex]                  ⚙️ 设置  │ ← Tab
├──────────────┬──────────────────────────────────┤
│ 📁 项目 (12) │ 🔍 搜索   [⭐ 仅看星标]            │
│ 全部      32 ├──────────────────────────────────┤
│ store      8 │ ⭐ 修复登录 bug    erp  10:30 🗑️  │
│ erp       15 │   "想把 login..."  24 轮          │
│ hr         3 ├──────────────────────────────────┤
│ manager    1 │   重构 API        store 09:42 🗑️ │
│ ...          │   "把这个文件..."  8 轮            │
└──────────────┴──────────────────────────────────┘
点会话 → 右侧 60% 宽度抽屉 (或全屏切换按钮)
```

Codex tab：左侧改成"按月分组"列表（2026-05, 2026-04, ...），其余一致。

## 7. 项目结构

```
message_manager/
├── docs/specs/2026-05-22-message-manager-design.md
├── package.json
├── electron.vite.config.ts
├── tsconfig.json
├── tsconfig.node.json
├── tsconfig.web.json
├── tailwind.config.js
├── postcss.config.js
├── src/
│   ├── main/
│   │   ├── index.ts          # Electron app entry
│   │   ├── scanner.ts
│   │   ├── reader.ts
│   │   ├── deleter.ts
│   │   ├── star.ts
│   │   ├── paths.ts
│   │   ├── store.ts          # ~/.claude-manager/ 读写
│   │   └── ipc.ts
│   ├── preload/
│   │   ├── index.ts
│   │   └── index.d.ts        # window.api 类型声明
│   └── renderer/
│       ├── index.html
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           ├── types.ts
│           ├── api.ts
│           ├── styles.css
│           └── components/
│               ├── TabSwitch.tsx
│               ├── ProjectSidebar.tsx
│               ├── SessionList.tsx
│               ├── SessionListItem.tsx
│               ├── DetailDrawer.tsx
│               └── EventRenderer.tsx
└── .gitignore
```

## 8. 不在 v1 范围内（明确放弃）

- 全文索引和搜索（仅元信息搜索）
- 导出为 Markdown
- 多语言（中文界面写死）
- 暗黑模式
- 跨设备同步
- 处理 `~/.codex/logs_2.sqlite`、`~/.codex/history.jsonl`、`~/.codex/memories/`
- 编辑会话内容

## 9. 验收标准

- 应用能启动，窗口正常显示
- Claude Tab 能列出 `~/.claude/projects/` 下所有项目及其会话，每条会话显示预览
- Codex Tab 能列出 `~/.codex/sessions/` 下所有会话
- 点击会话能看到详情，含工具调用
- 删除走二次确认，文件实际被移动到 `~/.claude-manager/trash/`
- 加星后再点取消能切换
- 关闭重开窗口位置、当前 tab 能恢复
