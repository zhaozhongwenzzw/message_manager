# Recall

> 本地 Electron 桌面应用，统一管理 **Claude Code** 与 **Codex** 的历史对话 —— 浏览、全文搜索、按项目/月份归类、收藏、软删除回收站、详情查看（含工具调用 / 子代理 / 思考过程）、AI 续聊简报、在系统终端一键 resume。

![version](https://img.shields.io/github/v/release/zhaozhongwenzzw/message_manager?style=flat-square)
![platform](https://img.shields.io/badge/platform-Windows-blue?style=flat-square)
![stack](https://img.shields.io/badge/stack-Electron%20%2B%20React-orange?style=flat-square)

---

## 为什么需要

![Why Recall](docs/images/recall-anime-why-need-it-v4.png)

如果你和我一样长期在用 Claude Code / Codex CLI，你的 `~/.claude/projects/` 和 `~/.codex/sessions/` 下应该已经堆了几百上千条 `.jsonl`。两套工具的目录结构、文件格式、归类逻辑都不一样，原生没办法：
- 跨工具一起浏览
- 按内容全文搜索（不只是文件名）
- 把废弃会话扔进回收站而不是 `rm -rf`
- 一键 resume 一条几个月前的会话
- 把长对话压成可粘贴到新 LLM 的"续聊简报"

Recall 把这些抹平成一个本地 app。**源目录全只读**，所有写入都落在 `~/.claude-manager/`。

---

## 主要功能

| 区块 | 能力 |
| --- | --- |
| **浏览** | 左侧按项目（Claude）/ 月份或项目（Codex 可切换）分组；中间会话列表带预览、消息数、字节数、相对时间；右侧抽屉详情，长会话虚拟滚动 |
| **全文搜索** | MiniSearch + bigram 中文分词；事件级倒排索引，搜出哪些消息命中、关键字高亮、点击直接跳转对应事件 |
| **收藏 & 回收站** | 一键加星、按收藏过滤；软删除到独立回收站（默认 `~/.claude-manager/trash`，可改路径）；回收站可恢复 / 彻底删除 / 清空，冲突时弹覆盖/重命名选择 |
| **Codex 归档** | 在 app 里直接归档/取消归档（移动到 Codex 自己的 `archived_sessions/`），侧栏有「已归档」虚拟分类，标题用 Codex 自己生成的 `thread_name`（不再是抠出来的 system prompt 噪声） |
| **AI 续聊简报** | OpenAI 兼容 API，自动 map-reduce 串行精炼超长会话（contextWindow 可配 8k~1M），流式输出 800-1500 token 的 markdown 简报，可保存为 `.md` 或一键复制 |
| **在终端 resume** | 会话卡上点 `Terminal` 按钮，自动开系统默认终端（Win Terminal / Terminal.app / gnome-terminal 等）`cd` 到原 cwd 后跑 `claude --resume <id>` 或 `codex resume <id>` |
| **设置** | 外观主题、回收站路径、搜索索引重建、AI 助手配置、Claude/Codex CLI 路径、关于与检查更新，sidebar 分区导航 |
| **自动更新** | 静默检查、用户确认才下载；下载完弹「重启安装」；release notes 自动从 git log 生成并在更新弹窗里渲染 |

---

## 截图

![Recall preview](docs/images/recall-github-promo-real.png)

---

## 安装

### 普通用户

下载最新版本：
- **NSIS 安装包**：[Recall-Setup-x.y.z.exe](https://github.com/zhaozhongwenzzw/message_manager/releases/latest) —— 推荐，带桌面/开始菜单快捷方式、自动更新
- **免安装版**：`Recall-Portable-x.y.z.exe` —— 解压即用，不写注册表

### 自己跑

```bash
git clone https://github.com/zhaozhongwenzzw/message_manager.git
cd message_manager
npm install
npm run dev          # 启动开发模式
```

### 自己打包

```bash
npm run dist:win                    # 只 build 不发布
npm run release:win -- -p           # bump patch 版本 + 发布到 GitHub Releases
npm run release:win -- -m           # bump minor + 发布
npm run release:win -- -M           # bump major + 发布
```

发布需要在项目根目录建 `.env` 文件（参考 `.env.example`）写入 `GH_TOKEN`，token 要有 `repo` scope。

---

## 数据布局

Recall **绝不写源目录**。所有应用数据落在：

| 路径 | 用途 |
| --- | --- |
| `~/.claude-manager/config.json` | 用户配置（外观、回收站路径、Codex 分组、CLI 路径…） |
| `~/.claude-manager/metadata.json` | 收藏数据 |
| `~/.claude-manager/trash/` | 软删除目录（可改） |
| `~/.claude-manager/search-index.json` | MiniSearch 序列化索引，删了下次启动自动重建 |
| `~/.claude-manager/llm-key.enc` | AI 助手 API Key（safeStorage 加密，仅本机可解） |

只读源目录：`~/.claude/projects/`、`~/.codex/sessions/`、`~/.codex/archived_sessions/`、`~/.codex/session_index.jsonl`。

---

## 技术栈

- **Electron 35** + **electron-vite**（主/preload/renderer 分离构建）
- **React 18** + **TypeScript**（严格模式）
- **Tailwind** + **Radix UI** + **lucide-react**（白色简约风，浅/深主题切换）
- **MiniSearch**（纯 JS 全文索引，零原生依赖，CJK bigram 分词）
- **electron-updater**（GitHub Releases 自动更新通道）

---

## 开发文档

技术细节、模块说明、IPC 列表、自动更新流程见 [docs/modules.md](docs/modules.md)。

设计规范（功能 spec）：
- [全文搜索](docs/specs/2026-05-23-full-text-search-design.md)
- [AI 续聊简报](docs/specs/2026-05-24-ai-summarize-design.md)
- [在终端 resume](docs/specs/2026-05-27-terminal-resume-design.md)

自动更新发版手册：[docs/auto-update.md](docs/auto-update.md)。

---

## 路线图

- [x] 浏览 + 搜索 + 收藏 + 回收站
- [x] AI 续聊简报（OpenAI 兼容，自动分块）
- [x] Codex 归档 + 按项目分组
- [x] 在系统终端一键 resume
- [x] 自动更新 + release notes
- [ ] 统计仪表盘（使用频率热力图、项目活跃度、工具调用排行）
- [ ] 命令面板 + 键盘快捷键
- [ ] 标签与备注（比 star 表达力强一档）
- [ ] 跨工具迁移（Claude ↔ Codex 格式互转）
- [ ] `~/.claude` 资源浏览器（skills / agents / memory）

---

## 设计原则

- 数据写入只发生在 `~/.claude-manager/`；源目录全只读
- 任何破坏性操作（删除会话、删除项目、下载更新、安装更新）必须用户在 UI 上点击确认
- 扫描只读首行 + 首条用户消息做预览，避免 JSON.parse 整个大文件
- 全文搜索按需建事件级倒排索引，增量同步、可重建
- UI 走白色简约风：白卡片、圆角、品牌色、浅 hover；不同事件类型用色彩 + 图标 + 卡片层级清晰区分（用户=蓝 / 助手=品牌 / 工具=黄 / 子代理=紫 / 思考=灰 / 错误=红）
- 跨平台外部调用（终端 / 文件选择器 / 自动更新）封装到主进程，渲染端不感知平台差异

---

## License

MIT
