# 命令面板 & 全局键盘快捷键 · 设计

> 2026-05-28 · v0.4

## 背景

Recall 在 v0.3 之前所有动作都靠鼠标点 Header / SettingsDialog / Sidebar 的按钮。重度用户在 Claude / Codex 之间频繁切换、反复进设置或回收站时步骤太多，缺少键盘第一类工作流。

本次给 v0.4 加两件事：

1. **命令面板**（`Ctrl/Cmd+K`）：覆盖式 overlay，开箱即用的动作列表 + 输入 2+ 字符调 `api.searchQuery` 显示会话命中、回车直接打开会话。
2. **全局键盘快捷键**：常用动作有快捷键，面板内每条命令右侧显示对应快捷键提示。

范围决策（用户拍板）：
- 面板内容 = **动作 + 会话快速跳转**（不是纯 spotlight 也不是纯命令调度）
- **不重映射 `Ctrl+R`**（避免与 Electron 默认 reload 冲突），刷新只放在面板里。

---

## 快捷键映射

| 快捷键 | 动作 | 备注 |
| --- | --- | --- |
| `Ctrl/Cmd+K` 或 `Ctrl/Cmd+P` | 打开 / 关闭命令面板 | 输入框聚焦时也生效 |
| `Ctrl/Cmd+,` | 打开设置 | 输入框聚焦时也生效 |
| `Ctrl/Cmd+1` | 切到 Claude Code | 自动退出回收站视图 |
| `Ctrl/Cmd+2` | 切到 Codex | 自动退出回收站视图 |
| `Ctrl/Cmd+F` | 聚焦 SessionList 搜索框 | 回收站视图下静默 |
| `Ctrl/Cmd+B` | 切换主视图 / 回收站 | |
| `Ctrl/Cmd+S` | 切换"仅看收藏" | 回收站视图下静默 |
| `?`（裸键，shift+/） | 打开面板并切到「快捷键速查」 | 输入框聚焦时不触发 |
| `Esc` | 关闭面板 / 抽屉 / 设置 | Radix Dialog 自带，不在 hook 里处理 |

macOS 上 `Cmd` 等价于 `Ctrl`：判定写 `event.metaKey \|\| event.ctrlKey`。

输入框聚焦时（INPUT / TEXTAREA / contenteditable=true）只屏蔽**裸键快捷键**（目前只有 `?`），所有带 `Ctrl/Cmd` 修饰的快捷键照常触发——用户在搜索框里按 `Ctrl+1` 显然是要切 Tab，不是要输入字符。

---

## 命令清单

| 分组 | 命令 | 快捷键 | 禁用条件 |
| --- | --- | --- | --- |
| 导航 | 切换到 Claude Code | `Ctrl+1` | 当前已在 Claude / 回收站视图 |
| 导航 | 切换到 Codex | `Ctrl+2` | 当前已在 Codex / 回收站视图 |
| 导航 | 聚焦会话搜索框 | `Ctrl+F` | 回收站视图 |
| 视图 | 进入回收站视图 / 返回主视图 | `Ctrl+B` | — |
| 视图 | 开启 / 关闭「仅看收藏」 | `Ctrl+S` | 回收站视图 |
| 视图 | Codex 按月份分组 | — | 非 Codex / 已是月份 |
| 视图 | Codex 按项目分组 | — | 非 Codex / 已是项目 |
| 操作 | 重新扫描 | — | — |
| 操作 | 打开设置 | `Ctrl+,` | — |
| 操作 | 在文件管理器中打开回收站 | — | — |
| 操作 | 显示快捷键帮助 | `?` | `keepOpen: true`，原地切视图 |
| 外观 | 浅色模式 | — | 当前已是 |
| 外观 | 深色模式 | — | 当前已是 |
| 外观 | 跟随系统 | — | 当前已是 |

---

## 实现拆解

### `hooks/useGlobalShortcuts.ts`

单一 `window keydown` 监听器，传入 handlers 对象（用 `useMemo` 稳定引用避免重复挂载）。**修饰键快捷键（Ctrl/Cmd+...）无视输入框聚焦**，确保用户在 SessionList 搜索框里也能 `Ctrl+1/2` 切 Tab；只有裸键（`?`）会在输入框聚焦时被屏蔽，留给用户正常输入。导出辅助函数 `focusSearchInput()`：通过 `window.dispatchEvent(new CustomEvent('recall:focus-search'))` 远程聚焦，避免给组件树拉 ref props 链。`SessionList` 内部 `useEffect` 监听该事件 → `inputRef.current?.focus() + select()`。

### `components/CommandPalette.tsx`

- Radix `Dialog` 做 overlay + focus trap，沿用现有 `dialog-overlay` 样式 + 新增 `dialog-popup-top` class（专用 `popupSlideDown` 关键帧：只在 Y 方向轻微下移，避免 `popupZoomIn` 的 `translate(-50%,-50%)` 对仅 X 居中的面板造成"瞬间向上吸"卡顿）。
- 位置：`left-1/2 top-[18vh] -translate-x-1/2`，宽 `640px`。
- 命令模型：`{ id, label, group, hint?, keywords?, icon, disabled?, keepOpen?, run }`。`keepOpen` 让"显示快捷键帮助"原地切到 `ShortcutsHelp` 视图而非关闭面板。
- 命令过滤：`label + keywords + group` 大小写不敏感子串匹配；空查询时全显示。
- 会话搜索：输入 ≥ 2 字时 debounce 200ms 调 `api.searchQuery({ query, source: tab })`，取前 8 条；按 ↑↓ 在命令与会话间连续选中，Enter 执行选中项。
- 选中态：`bg-brand-500/15`（半透明品牌色，光暗模式都可读），图标容器 `bg-brand-500/20 + ring-1 ring-brand-500/30`。**不要用 `bg-brand-50`**，因为 brand-50 是 theme-aware 不是 appearance-aware，深色模式下仍是浅奶色会洗白文字。
- 二级视图 `ShortcutsHelp`：表格化展示所有快捷键，回 `←` 或 Esc 返回命令视图。
- 禁用规则集中在 `commands` 的 `useMemo` 内，依赖 `tab / view / starredOnly / appearance / codexGrouping`。

### `App.tsx` 接线

新增 `paletteOpen / paletteInitialView` 状态。`shortcutHandlers` 用 `useMemo` 包装，再喂给 `useGlobalShortcuts`。切 Tab 走统一 `switchTab` 助手：`setTab(t) + setSelectedProjectKey('__all__') + setView('main')`，命令面板和 Header 都共用它。

挂载 `<CommandPalette/>` 与 `<SummarizeDialog/>` 同级；Header 新增 `onOpenPalette` prop 把"⌘K"提示按钮接到状态。

---

## 验收清单

- `Ctrl+K` 任意状态都能开/关面板；面板打开时再按 `Ctrl+K` 关闭。
- 在 Claude 按 `Ctrl+2` 切到 Codex；回收站视图下按 `Ctrl+1/2` 也能切（自动 `view='main'`）。
- 设置开着时 `Ctrl+K` 仍能开面板（z-60 高于设置 z-50）。
- `Ctrl+F` 聚焦 SessionList 搜索框并选中现有内容；回收站视图下不响应。
- `Ctrl+B` 切回收站；回收站状态下面板的「切换 Tab」「仅看收藏」「聚焦搜索」灰显。
- 在 input/textarea 聚焦时按 `?` 不触发，按 `Ctrl+1` 不切 Tab；按 `Ctrl+K` 仍能开面板。
- 输入"test" → 200ms 后出现会话命中行，↓ 选中、Enter 打开 DetailDrawer。
- 命令面板的「显示快捷键帮助」原地切到表格，按 `←`/Esc 返回，不会因关面板看不到表格。
- 深色模式下选中行文字清晰可读。
- 面板打开动画**不再瞬间向上吸**。

---

## 后续可做

- 命令面板里加入「打开特定项目」「按特定月份过滤」之类的多级命令（仿 Linear 命令面板的子菜单）
- 在状态栏底部加一句快捷键提示，进一步提升发现性
- 让快捷键映射可配置（`Ctrl+R` 是否拦截、自定义快捷键写到 `config.json`）
