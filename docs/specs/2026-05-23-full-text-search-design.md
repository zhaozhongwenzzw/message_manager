# 全文搜索设计文档（v0.2）

> 作者：assistant · 日期：2026-05-23 · 状态：**待审阅**
> 目标版本：Recall v0.2.0

---

## 1. 问题与目标

### 1.1 现状
当前 [SessionList.tsx](../../src/renderer/src/components/SessionList.tsx) 的搜索框只对三个字段做 substring 大小写不敏感匹配：
- `session.preview`（首条用户消息前 120 字）
- `session.projectLabel`
- `session.id`

会话正文（assistant 回复 / 工具输入输出 / thinking）**完全不可搜索**。
当用户记得"我之前问过 electron-updater 怎么处理 404"或"哪个会话提到过 FTS5"时，无法定位。

### 1.2 目标（v0.2 范围）
1. **可搜全文**：搜索词命中任意 user / assistant / thinking / tool_use input / tool_result content 都能命中所在会话。
2. **快速**：5000 条会话量级下，输入关键词到出结果 < 300ms。
3. **可定位到事件**：搜索结果不仅显示会话条目，还要能跳到具体命中的消息（DetailDrawer 自动滚动并高亮）。
4. **支持中文**：必须能搜中文词（这是核心场景）。
5. **零原生依赖**：不引入 `better-sqlite3` 等需要 prebuild 的包，保持 `electron-builder` 当前打包流程不变。
6. **增量索引**：扫描时只索引新增/修改的会话，已索引的跳过；删除会话时同步从索引移除。

### 1.3 非目标（v0.2 不做）
- 正则搜索、高级查询语法（AND/OR/NOT/字段限定）
- 跨会话的"答案级"语义搜索（向量检索）
- 在 Header 全局放一个独立的搜索入口（命令面板放到 v0.3）
- 搜索历史 / 收藏搜索词

---

## 2. 技术选型

### 2.1 候选对比

| 方案 | 中文支持 | 包大小 | Native 依赖 | 增量 | 性能（5k 会话）| 维护成本 |
| --- | --- | --- | --- | --- | --- | --- |
| **MiniSearch** | 需自定义 tokenize | ~25KB gz | ❌ | ✅ | ~50–150ms 查询 | 低 |
| FlexSearch | 内置 CJK | ~40KB gz | ❌ | ✅ | ~30–80ms | 中（API 不够直观，迁移风险大）|
| Lunr.js | 中文需 lunr-languages 插件 | ~30KB gz | ❌ | ❌（rebuild）| ~200ms | 中 |
| better-sqlite3 + FTS5 | 内置 unicode61 | ~3MB（含 .node）| ✅ | ✅ | <20ms | 高（prebuild × 多平台）|

### 2.2 决策：MiniSearch + bigram 中文分词

- **MiniSearch** 是 pure JS，零原生依赖，API 简洁，索引可序列化为 JSON。
- 中文不能按"空格分词"，所以我们自己写一个 `tokenize` 函数：
  - 英文/数字：按 `\W+` 拆词
  - 中文：用 **bigram**（2-gram），如 "回收站管理" → `["回收", "收站", "站管", "管理"]`。MiniSearch 的 prefix search 配合 bigram 能覆盖"输入两个字就命中"的体验。
  - 混合：把英文和中文分别处理后合并 token 列表。
- 索引在主进程内存中持有 + 序列化到磁盘（`~/.claude-manager/search-index.json`），重启加载。

**为什么不上 FlexSearch**：FlexSearch 的 CJK encoder 是把每个汉字单独成 token，等价于 unigram，召回过宽（输入"管"命中所有含"管"的会话）。Bigram 在召回和精度间的折衷更适合对话场景。

### 2.3 性能预算
- 5000 会话 × 平均 80 条消息 × 平均每条 200 字 = 80M 字符。
- bigram 后约 40M token，去重后预计 ~200K 唯一词项。
- MiniSearch 索引体积估算：~80MB JSON。**这超预算**，需要瘦身策略：
  - **不索引 tool_result 全文**，只索引首 500 字（工具结果常常是几千行日志，对搜索价值低）
  - **不索引 raw JSON**
  - **不索引 unknown / parse_error**
  - 索引的字段：`user`、`assistant`、`thinking`、`tool_use.name` + `tool_use.input`（截断 500 字）、`tool_result.content`（截断 500 字）

预期瘦身后索引体积 < 30MB JSON，首次加载 < 1s。

---

## 3. 数据模型

### 3.1 索引文档单元

**一条索引 doc = 一个 NormEvent**（不是一个会话）。这样能定位到事件层级。

```ts
type SearchDoc = {
  id: string;            // `${sessionPath}#${eventIndex}` — 主键
  sessionPath: string;   // 会话绝对路径（用于过滤 + 反向跳转）
  source: 'claude' | 'codex';
  projectKey: string;
  projectLabel: string;
  eventIndex: number;    // NormEvent.index
  kind: NormEvent['kind'];
  text: string;          // 已 tokenize 前的原文（截断后）
  ts?: number;           // 事件时间戳
};
```

MiniSearch 搜索字段：`text`（全文）+ `projectLabel`（项目名也可搜）。
存储字段（搜索结果回显需要）：所有字段。

### 3.2 会话级元数据

为了支持增量索引、检测哪些会话需要重新索引，单独存一个 manifest：

```ts
// ~/.claude-manager/search-manifest.json
type SearchManifest = {
  version: 1;                     // schema version，升级时强制 rebuild
  sessions: Record<string, {     // key = absolute session path
    mtime: number;                // fs.stat.mtimeMs
    size: number;                 // bytes
    eventCount: number;           // 索引时的事件数
    indexedAt: number;            // 索引时间戳
  }>;
};
```

### 3.3 文件布局

```
~/.claude-manager/
├── search-index.json       # MiniSearch.toJSON() 序列化结果（gzip 可选）
├── search-manifest.json    # 上面的 SearchManifest
```

> 不存到 trash 目录或源目录。索引可随时删除重建，不属于"用户数据"。

---

## 4. 主进程改动

### 4.1 新建 `src/main/search.ts`

```ts
export type SearchDoc = { ... };

// 单例 MiniSearch 实例，模块内 lazy 初始化
let miniSearch: MiniSearch<SearchDoc> | null = null;
let manifest: SearchManifest | null = null;

// 1. 启动时调用：从磁盘加载索引（如果有），否则空索引
export async function initSearch(): Promise<void>;

// 2. 单个会话索引/重建（添加新会话、文件 mtime 变了时调用）
export async function indexSession(filePath: string, source: Source): Promise<void>;

// 3. 批量同步：拿一批最新的 (path, mtime, size) 比对 manifest，
//    新增/变更的进入 indexSession 队列，删除的从索引移除
export async function syncSearchIndex(
  sessions: Array<{ path: string; source: Source; mtime: number; size: number; projectKey: string; projectLabel: string }>
): Promise<{ added: number; updated: number; removed: number }>;

// 4. 软删除/彻底删除会话时调用，从索引移除该会话所有 doc
export async function removeSessionFromIndex(filePath: string): Promise<void>;

// 5. 查询接口
export type SearchHit = {
  sessionPath: string;
  source: Source;
  projectLabel: string;
  ts?: number;
  matches: Array<{
    eventIndex: number;
    kind: NormEvent['kind'];
    excerpt: string;        // 命中词前后 60 字
    score: number;
  }>;
  bestScore: number;
};
export async function search(query: string, opts?: {
  source?: Source;
  limit?: number;            // 默认 50
  perSessionLimit?: number;  // 单会话最多保留的命中事件数，默认 5
}): Promise<SearchHit[]>;

// 6. 持久化（debounce 5s）
function persist(): void;

// 7. 强制重建（设置里"重建索引"按钮 + manifest version 不匹配时）
export async function rebuildIndex(): Promise<void>;
```

**关键内部函数 `tokenize(text: string)`**：

```ts
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  // 1) 英文/数字串
  const ascii = text.match(/[A-Za-z0-9_]+/g) ?? [];
  tokens.push(...ascii.map((s) => s.toLowerCase()));
  // 2) 中文 bigram（任意 CJK 字符）
  const cjk = text.match(/[一-鿿]+/g) ?? [];
  for (const run of cjk) {
    if (run.length === 1) tokens.push(run); // 单字也保留
    for (let i = 0; i < run.length - 1; i++) {
      tokens.push(run.slice(i, i + 2));
    }
  }
  return tokens;
}
```

MiniSearch 初始化时把 `tokenize` 同时作为 `tokenize` 和 `processTerm`（小写化已经在 tokenize 里做了）。

### 4.2 复用 `reader.ts`

`indexSession()` 内部直接调用 `readSession(filePath)` 拿 `NormEvent[]`，对每个事件按 [§3.1](#31-索引文档单元) 转 `SearchDoc`，并应用 [§2.3](#23-性能预算) 的字段筛选 + 截断规则。

### 4.3 `ipc.ts` 注册新通道

| 通道 | 入参 | 出参 | 说明 |
| --- | --- | --- | --- |
| `search:query` | `{ query: string; source?: Source }` | `SearchHit[]` | 实时搜索 |
| `search:rebuild` | — | `{ added: number; durationMs: number }` | 设置里"重建索引"用 |
| `search:status` | — | `{ indexedSessions: number; totalDocs: number; lastBuildAt?: number }` | 设置里展示 |

### 4.4 与 `scanner.ts` 的集成

`scanClaude()` / `scanCodex()` 结束时 **不**直接索引（首屏要快）。
改在 `ipc.ts` 的 `scan:*` 通道里：扫描完成后**异步**触发 `syncSearchIndex()`，把这次扫描得到的 session 列表传过去对比 manifest。
索引过程不阻塞 UI，进度通过 `search:status` 事件可选地推给渲染端（v0.2 先不做进度条，设置里点"状态"按钮主动拉就够）。

### 4.5 删除联动

[deleter.ts](../../src/main/deleter.ts) 软删除时（ipc.ts 的 `delete:session` / `delete:claude-project` 处理器中）顺手调 `removeSessionFromIndex()`。
[trash.ts](../../src/main/trash.ts) 的 `purgeFromTrash` / `restoreFromTrash` 不需要动索引（trash 里的文件本来就不在索引中；restore 后会下次扫描时自动入索引）。

---

## 5. 渲染端改动

### 5.1 API & 类型

`api.ts` 增加：

```ts
searchQuery: (args: { query: string; source?: Source }) => Promise<SearchHit[]>;
searchRebuild: () => Promise<{ added: number; durationMs: number }>;
searchStatus: () => Promise<SearchStatus>;
```

`types.ts` 新增 `SearchHit` / `SearchStatus`（与主进程类型保持一致）。

### 5.2 SessionList 搜索升级

**核心交互变化**：

1. 搜索框 placeholder 改成 **"全文搜索（会话内容、项目名、ID）"**。
2. 用户输入时 **debounce 200ms** 调 `api.searchQuery`，得到 `SearchHit[]`。
3. 搜索框右侧加一个**模式徽章**：
   - 空查询：徽章不显示，列表回到当前 tab 的全量会话（沿用现有逻辑）。
   - 有查询：徽章显示 `<N> 个会话命中`，列表替换为命中会话。
4. 列表渲染：
   - 沿用 `SessionListItem` 卡片样式，但 **preview 区域替换成命中片段**：每个会话最多显示 3 条命中事件的 excerpt，关键词用 `<mark>` 高亮，前面用小图标区分 kind（user=蓝点 / assistant=橙点 / tool=黄点 / thinking=灰点）。
   - 点卡片打开 DetailDrawer 时，**带上首个命中事件的 eventIndex**，DetailDrawer 接到后自动滚动到该事件并临时高亮（黄色边框 1.5s 淡出）。

### 5.3 DetailDrawer 跳转锚点

[DetailDrawer.tsx](../../src/renderer/src/components/DetailDrawer.tsx) 接收新的可选 prop `jumpToEvent?: number`：
- 读到 `NormEvent[]` 后，若有 `jumpToEvent`，调 `virtualizer.scrollToIndex(jumpToEvent, { align: 'center' })`。
- 给该事件包一层 div + className `ring-2 ring-warn-400 ring-offset-2 animate-[searchHit_1500ms_ease-out]`，在 styles.css 里加这个 keyframe（fade ring opacity 1 → 0）。

### 5.4 关键词高亮工具

新建 `src/renderer/src/utils/highlight.tsx`：

```tsx
export function highlightTerms(text: string, terms: string[]): React.ReactNode;
```

把 `terms`（来自查询的 tokenize 结果）在 text 中找出所有出现位置（大小写不敏感 + 中文按 bigram 反查），用 `<mark className="bg-warn-100 text-warn-900 rounded px-0.5">` 包起来。
搜索结果卡片和 DetailDrawer 命中事件都用它。

### 5.5 设置里加索引状态

[SettingsDialog.tsx](../../src/renderer/src/components/SettingsDialog.tsx) 新增「搜索索引」分区：
- 显示：已索引 N 个会话 / 共 M 个事件 / 上次构建时间
- 按钮：「重建索引」（带 confirm，运行时显示 spinner）
- 提示：「索引存放在 `~/.claude-manager/search-index.json`，可随时安全删除」

---

## 6. 边界 & 风险

### 6.1 索引体积超预期
**风险**：实际用户会话数据可能比估算大很多（重度用户 10k+ 会话）。
**缓解**：
- 内置硬上限：单事件文本超过 2000 字 → 截断（不是 500，对正文友好一些；只 tool_result 限 500）
- 设置里显示磁盘占用，提供"重建索引"按钮
- 若 JSON 超过 100MB，考虑切换成分片或 gzip（v0.2 先观察，不提前优化）

### 6.2 首次构建耗时
**风险**：现有用户首次升级到 v0.2 时，可能要等几十秒到几分钟才能搜。
**缓解**：
- 首次构建在 worker 里跑（Node `worker_threads`），不阻塞 UI 线程
- 期间 SessionList 搜索框旁显示「索引中... 已完成 423 / 5000」**且**搜索仍可用，只是结果可能不全（命中已索引的部分）
- 完成后自动触发一次结果刷新

### 6.3 索引与数据不一致
**风险**：用户删除一个会话，但索引里还残留 doc → 搜索结果点进去 404。
**缓解**：
- 软删除路径主动调 `removeSessionFromIndex`
- 渲染端搜索结果点击时，若 `api.readSession(path)` 抛 ENOENT，弹一个 toast「文件已被删除，正在更新索引」并自动调 rebuild

### 6.4 中文 bigram 误召回
**示例**："回收站" 搜 "管理" 不会命中（OK），但搜 "理" 单字会命中所有"理"开头/结尾的二元组。
**缓解**：单字查询时只搜首字 + 提示用户多输几个字。或者 v0.2 不允许 < 2 字搜索（输入 1 个汉字时不触发查询）。

### 6.5 隐私
索引文件 `search-index.json` 包含**全部会话正文**（虽然截断了）。这是用户的 AI 对话内容，可能含敏感信息。
**缓解**：
- 默认存放路径 `~/.claude-manager/search-index.json`，跟现有 metadata/config 同级，与会话源数据同等敏感度。
- 文档中说明：删除该文件等于清空搜索索引，下次启动会自动重建。
- 不上传，不外传。

### 6.6 与 starredOnly / projectKey 过滤的组合
当前 `App.tsx` 的 `filtered` useMemo 里把 starredOnly + selectedProjectKey + query 串在一起。
全文搜索接管 query 这一步后：
- 主进程已经按 source 过滤
- 渲染端**收到 `SearchHit[]` 后**再二次 filter：按 `selectedProjectKey` 和 `stars` 过滤
- 这层在客户端做，性能足够（命中通常 < 200 条）

---

## 7. 任务拆解

按推荐实现顺序，每步可独立提交 + typecheck：

### Step 1 · 索引核心（主进程，无 UI）
- [ ] 新建 [src/main/search.ts](../../src/main/search.ts)：`tokenize` / `indexSession` / `syncSearchIndex` / `removeSessionFromIndex` / `search` / `persist` / `initSearch` / `rebuildIndex`
- [ ] 添加 `minisearch` 依赖（`npm i minisearch`，纯 JS 包）
- [ ] [src/main/index.ts](../../src/main/index.ts) `app.whenReady` 后调 `initSearch()`（不阻塞窗口创建）
- [ ] 单元自测：在 main 中加个临时 `console.log(await search('xxx'))` 验证

### Step 2 · IPC 暴露
- [ ] [src/main/ipc.ts](../../src/main/ipc.ts) 注册 `search:query` / `search:rebuild` / `search:status`
- [ ] 在 `scan:claude` / `scan:codex` 处理器里异步调 `syncSearchIndex`（不 await）
- [ ] 在 `delete:session` / `delete:claude-project` 处理器里调 `removeSessionFromIndex`
- [ ] [src/preload/index.ts](../../src/preload/index.ts) 暴露 3 个新方法
- [ ] [src/renderer/src/api.ts](../../src/renderer/src/api.ts) typed 包装
- [ ] [src/renderer/src/types.ts](../../src/renderer/src/types.ts) 新增 `SearchHit` / `SearchStatus`

### Step 3 · 搜索结果列表
- [ ] [src/renderer/src/App.tsx](../../src/renderer/src/App.tsx)：新增 `searchHits` 状态 + debounce effect，根据 `query.trim()` 决定走全文搜索还是空态
- [ ] [src/renderer/src/components/SessionList.tsx](../../src/renderer/src/components/SessionList.tsx)：当处于搜索态时，渲染 `SearchHit` 而非 `SessionSummary`；新增 props
- [ ] 新建 `src/renderer/src/components/SearchHitItem.tsx`：搜索结果卡片
- [ ] 新建 `src/renderer/src/utils/highlight.tsx`：高亮工具
- [ ] 占位：点击搜索结果卡片暂时只打开会话（不跳转事件），跳转逻辑放 Step 4

### Step 4 · 事件跳转 + 高亮
- [ ] [src/renderer/src/components/DetailDrawer.tsx](../../src/renderer/src/components/DetailDrawer.tsx)：新增 `jumpToEvent?: number` + `highlightTerms?: string[]` props
- [ ] 滚动到事件 + ring 动画
- [ ] 命中事件正文也走 `highlightTerms` 着色
- [ ] App.tsx 打开会话时把上下文（命中事件 + 查询词）传下去

### Step 5 · 设置 & 状态
- [ ] [src/renderer/src/components/SettingsDialog.tsx](../../src/renderer/src/components/SettingsDialog.tsx)：新增「搜索索引」section
- [ ] 「重建索引」按钮（带 confirm + 进度状态）

### Step 6 · 边界打磨
- [ ] 单字中文不触发查询 + 提示
- [ ] 搜索结果点击后文件不存在 → toast + 自动 rebuild
- [ ] 首次启动时索引不存在 → 后台构建 + 顶栏小角标提示
- [ ] manifest schema version mismatch → 自动 rebuild

### Step 7 · 文档 & 发版
- [ ] 更新 [docs/modules.md](../modules.md)：补 `search.ts` 模块说明 + 3 个 IPC 通道
- [ ] 更新 README 截图（如有）
- [ ] 测试 7 项验证清单（§8）全过
- [ ] `npm version minor` → 0.2.0
- [ ] `npm run release:win`

---

## 8. 验证清单

dev 模式 + 打包后均需通过：

1. **基础搜索**：输入 "electron-updater"，命中我之前讨论 updater 的会话；点开高亮跳到对应事件
2. **中文搜索**：输入 "回收站"，命中之前讨论 trash 功能的会话
3. **混合搜索**：输入 "MiniSearch FTS5"，能命中本文档讨论的会话
4. **空态恢复**：清空搜索框，列表回到全量
5. **过滤组合**：选中某项目 + starredOnly + 搜索词，三者同时生效
6. **删除一致性**：搜到一个会话 → 主视图删除它 → 同样的查询不再命中
7. **冷启动**：删除 `~/.claude-manager/search-index.json` 重启 app，能看到"索引中"状态，最终所有查询正常工作
8. **重建索引**：设置里点重建，spinner 转完后数据未丢失
9. **大数据量**：人工生成 1000+ 会话样本（脚本），首次索引 < 30s，单次查询 < 300ms
10. **跨平台**：Windows 打包安装后路径处理正确（特别注意 path.join 与 `\` / `/` 在 JSON key 里的一致性）

---

## 9. 时间预估

| 步骤 | 预估 |
| --- | --- |
| Step 1 索引核心 | 0.5 天 |
| Step 2 IPC | 0.2 天 |
| Step 3 搜索结果 UI | 0.5 天 |
| Step 4 跳转 + 高亮 | 0.3 天 |
| Step 5 设置 UI | 0.2 天 |
| Step 6 边界 | 0.5 天 |
| Step 7 文档发版 | 0.2 天 |
| **合计** | **~2.5 天** |

---

## 10. 待用户决策

请审阅后回答（或直接说"按文档来"）：

1. **bigram vs unigram**：本方案选 bigram（输入 2 字才开始召回）。你倾向更激进的 unigram（输入 1 字就召回）吗？  
   _推荐 bigram，避免噪声。_✅

2. **索引存储位置**：默认 `~/.claude-manager/search-index.json`。是否希望放到独立子目录如 `~/.claude-manager/search/`？  
   _推荐保持现位置，跟 metadata/config 同级。_✅

3. **搜索结果点击行为**：默认打开 DetailDrawer 并滚到命中事件。要不要保留"在新窗口打开"选项？  
   _v0.2 不做新窗口，保持简洁。_✅

4. **是否需要 `worker_threads` 跑首次索引**：会让代码更复杂（多进程通信 + Electron 打包 worker 路径处理）。  
   _推荐 v0.2 先在主线程里跑（5k 会话量级足够），观察用户反馈后 v0.3 再上 worker。_✅

5. **是否提供 "搜索仅当前项目" 复选框**：当用户在某个项目内时，是否默认把搜索限定到该项目？  
   _推荐默认搜全局，提供一个角标按钮「限定当前项目」。_✅

6. **首字段权重**：MiniSearch 支持字段权重。`user` 消息的命中是否应该比 `tool_result` 权重更高？  
   _推荐 `user`/`assistant` × 2.0，`thinking` × 1.0，`tool_use`/`tool_result` × 0.5。_✅

请用 ✅/❌ 标注每条，并补任何调整意见。审阅完成后我会按 §7 的顺序开始实现 Step 1。
