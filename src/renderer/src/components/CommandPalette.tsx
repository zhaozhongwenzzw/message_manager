import * as Dialog from '@radix-ui/react-dialog';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Command as CommandIcon,
  FolderTree,
  Keyboard,
  Monitor,
  Moon,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  Star,
  Sun,
  Trash2
} from 'lucide-react';
import clsx from 'clsx';
import claudeIcon from '@assets/image/claude-color.svg';
import codexIcon from '@assets/image/codex-color.svg';
import { api } from '../api';
import type { Appearance, SearchHit, SessionSummary, Source } from '../types';
import { highlightTerms } from '../utils/highlight';

type CommandGroup = '导航' | '视图' | '操作' | '外观';

type PaletteCommand = {
  id: string;
  label: string;
  group: CommandGroup;
  hint?: string;
  keywords?: string;
  icon: React.ReactNode;
  disabled?: boolean;
  keepOpen?: boolean;
  run: () => void;
};

export type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialView?: 'commands' | 'shortcuts';
  tab: Source;
  view: 'main' | 'trash';
  starredOnly: boolean;
  appearance: Appearance;
  codexGrouping: 'month' | 'project';
  onTabChange: (t: Source) => void;
  onToggleTrash: () => void;
  onToggleStarredOnly: () => void;
  onAppearanceChange: (a: Appearance) => void;
  onCodexGroupingChange: (g: 'month' | 'project') => void;
  onRefresh: () => void;
  onOpenSettings: () => void;
  onFocusSearch: () => void;
  onOpenSession: (s: SessionSummary) => void;
};

const SHORTCUT_TABLE: Array<{ keys: string; desc: string }> = [
  { keys: 'Ctrl/Cmd + K', desc: '打开 / 关闭命令面板' },
  { keys: 'Ctrl/Cmd + P', desc: '打开 / 关闭命令面板' },
  { keys: 'Ctrl/Cmd + ,', desc: '打开设置' },
  { keys: 'Ctrl/Cmd + 1', desc: '切到 Claude Code' },
  { keys: 'Ctrl/Cmd + 2', desc: '切到 Codex' },
  { keys: 'Ctrl/Cmd + F', desc: '聚焦会话搜索框' },
  { keys: 'Ctrl/Cmd + B', desc: '切换主视图 / 回收站' },
  { keys: 'Ctrl/Cmd + S', desc: '切换"仅看收藏"' },
  { keys: '?', desc: '打开快捷键速查（非输入框聚焦时）' },
  { keys: 'Esc', desc: '关闭面板 / 抽屉' },
  { keys: '↑ / ↓', desc: '在命令/会话列表移动' },
  { keys: 'Enter', desc: '执行选中项' }
];

function matchCommand(cmd: PaletteCommand, query: string): boolean {
  if (!query) return true;
  const hay = (cmd.label + ' ' + (cmd.keywords ?? '') + ' ' + cmd.group).toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((q) => !q || hay.includes(q));
}

export default function CommandPalette(props: CommandPaletteProps): JSX.Element {
  const {
    open,
    onOpenChange,
    initialView = 'commands',
    tab,
    view,
    starredOnly,
    appearance,
    codexGrouping,
    onTabChange,
    onToggleTrash,
    onToggleStarredOnly,
    onAppearanceChange,
    onCodexGroupingChange,
    onRefresh,
    onOpenSettings,
    onFocusSearch,
    onOpenSession
  } = props;

  const [paneView, setPaneView] = useState<'commands' | 'shortcuts'>(initialView);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setPaneView(initialView);
      setQuery('');
      setActiveIdx(0);
      setHits([]);
    }
  }, [open, initialView]);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  const executeCommand = useCallback(
    (cmd: PaletteCommand) => {
      cmd.run();
      if (!cmd.keepOpen) close();
    },
    [close]
  );

  const openSessionFromHit = useCallback(
    (hit: SearchHit) => {
      const session: SessionSummary = {
        source: hit.source,
        path: hit.sessionPath,
        id: hit.sessionPath.split(/[\\/]/).pop() ?? '',
        preview: hit.matches[0]?.excerpt ?? '',
        timestamp: hit.ts ?? 0,
        size: 0,
        messageCount: 0,
        projectKey: hit.projectKey,
        projectLabel: hit.projectLabel
      };
      onOpenSession(session);
      close();
    },
    [onOpenSession, close]
  );

  const inTrash = view === 'trash';

  const commands = useMemo<PaletteCommand[]>(() => {
    const list: PaletteCommand[] = [
      {
        id: 'nav.claude',
        label: '切换到 Claude Code',
        group: '导航',
        hint: 'Ctrl+1',
        keywords: 'tab claude code orange 橙',
        icon: <img src={claudeIcon} alt="" className="h-3.5 w-3.5" draggable={false} />,
        disabled: inTrash || tab === 'claude',
        run: () => onTabChange('claude')
      },
      {
        id: 'nav.codex',
        label: '切换到 Codex',
        group: '导航',
        hint: 'Ctrl+2',
        keywords: 'tab codex blue 蓝',
        icon: <img src={codexIcon} alt="" className="h-3.5 w-3.5" draggable={false} />,
        disabled: inTrash || tab === 'codex',
        run: () => onTabChange('codex')
      },
      {
        id: 'nav.search',
        label: '聚焦会话搜索框',
        group: '导航',
        hint: 'Ctrl+F',
        keywords: 'search focus 搜索 查找',
        icon: <Search size={14} />,
        disabled: inTrash,
        run: onFocusSearch
      },
      {
        id: 'view.trash',
        label: inTrash ? '返回主视图' : '进入回收站视图',
        group: '视图',
        hint: 'Ctrl+B',
        keywords: 'trash recycle 回收站 删除',
        icon: <Trash2 size={14} />,
        run: onToggleTrash
      },
      {
        id: 'view.starred',
        label: starredOnly ? '关闭"仅看收藏"' : '开启"仅看收藏"',
        group: '视图',
        hint: 'Ctrl+S',
        keywords: 'star favorite 收藏 加星',
        icon: <Star size={14} />,
        disabled: inTrash,
        run: onToggleStarredOnly
      },
      {
        id: 'view.group.month',
        label: 'Codex 按月份分组',
        group: '视图',
        keywords: 'codex group month 月份',
        icon: <FolderTree size={14} />,
        disabled: inTrash || tab !== 'codex' || codexGrouping === 'month',
        run: () => onCodexGroupingChange('month')
      },
      {
        id: 'view.group.project',
        label: 'Codex 按项目分组',
        group: '视图',
        keywords: 'codex group project 项目 cwd',
        icon: <FolderTree size={14} />,
        disabled: inTrash || tab !== 'codex' || codexGrouping === 'project',
        run: () => onCodexGroupingChange('project')
      },
      {
        id: 'op.refresh',
        label: '重新扫描',
        group: '操作',
        keywords: 'refresh reload rescan 刷新 扫描',
        icon: <RefreshCw size={14} />,
        run: onRefresh
      },
      {
        id: 'op.settings',
        label: '打开设置',
        group: '操作',
        hint: 'Ctrl+,',
        keywords: 'settings preferences 设置 偏好',
        icon: <SettingsIcon size={14} />,
        run: onOpenSettings
      },
      {
        id: 'op.trash.folder',
        label: '在文件管理器中打开回收站',
        group: '操作',
        keywords: 'trash explorer finder 文件 文件夹',
        icon: <Trash2 size={14} />,
        run: () => {
          api.openTrash().catch(() => {});
        }
      },
      {
        id: 'op.shortcuts',
        label: '显示快捷键帮助',
        group: '操作',
        hint: '?',
        keywords: 'shortcuts help keyboard 快捷键 帮助',
        icon: <Keyboard size={14} />,
        keepOpen: true,
        run: () => setPaneView('shortcuts')
      },
      {
        id: 'theme.light',
        label: '浅色模式',
        group: '外观',
        keywords: 'theme light 浅色 白',
        icon: <Sun size={14} />,
        disabled: appearance === 'light',
        run: () => onAppearanceChange('light')
      },
      {
        id: 'theme.dark',
        label: '深色模式',
        group: '外观',
        keywords: 'theme dark 深色 黑',
        icon: <Moon size={14} />,
        disabled: appearance === 'dark',
        run: () => onAppearanceChange('dark')
      },
      {
        id: 'theme.system',
        label: '跟随系统',
        group: '外观',
        keywords: 'theme system auto 跟随 系统',
        icon: <Monitor size={14} />,
        disabled: appearance === 'system',
        run: () => onAppearanceChange('system')
      }
    ];
    return list;
  }, [
    tab,
    inTrash,
    starredOnly,
    appearance,
    codexGrouping,
    onTabChange,
    onToggleTrash,
    onToggleStarredOnly,
    onAppearanceChange,
    onCodexGroupingChange,
    onRefresh,
    onOpenSettings,
    onFocusSearch
  ]);

  const filteredCommands = useMemo(
    () => commands.filter((c) => matchCommand(c, query.trim())),
    [commands, query]
  );

  // Debounced session search (only when paneView==='commands' and query length>=2).
  useEffect(() => {
    if (paneView !== 'commands') return;
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    const t = window.setTimeout(async () => {
      try {
        const res = await api.searchQuery({ query: q, source: tab });
        if (seq === searchSeq.current) setHits(res.slice(0, 8));
      } catch {
        if (seq === searchSeq.current) setHits([]);
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 200);
    return () => window.clearTimeout(t);
  }, [query, tab, paneView]);

  // Flat selectable list = enabled commands + hits, in render order.
  const enabledCommands = filteredCommands.filter((c) => !c.disabled);
  const totalSelectable = enabledCommands.length + hits.length;

  useEffect(() => {
    if (activeIdx >= totalSelectable) setActiveIdx(0);
  }, [totalSelectable, activeIdx]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (paneView === 'shortcuts') {
        if (e.key === 'Escape' || e.key === 'Backspace') {
          e.preventDefault();
          setPaneView('commands');
        }
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => (totalSelectable === 0 ? 0 : (i + 1) % totalSelectable));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) =>
          totalSelectable === 0 ? 0 : (i - 1 + totalSelectable) % totalSelectable
        );
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (totalSelectable === 0) return;
        if (activeIdx < enabledCommands.length) {
          executeCommand(enabledCommands[activeIdx]);
        } else {
          const hit = hits[activeIdx - enabledCommands.length];
          if (hit) openSessionFromHit(hit);
        }
      }
    },
    [paneView, totalSelectable, activeIdx, enabledCommands, hits, executeCommand, openSessionFromHit]
  );

  // Scroll active row into view.
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, paneView]);

  const groupedCommands = useMemo(() => {
    const map = new Map<CommandGroup, PaletteCommand[]>();
    for (const c of filteredCommands) {
      if (!map.has(c.group)) map.set(c.group, []);
      map.get(c.group)!.push(c);
    }
    return [...map.entries()];
  }, [filteredCommands]);

  // Build a lookup index → flat selectable index for command rows.
  const flatIndexFor = useMemo(() => {
    const idx = new Map<string, number>();
    let i = 0;
    for (const c of filteredCommands) {
      if (!c.disabled) {
        idx.set(c.id, i);
        i++;
      }
    }
    return idx;
  }, [filteredCommands]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay fixed inset-0 z-[60] bg-ink-1/30 backdrop-blur-[2px]" />
        <Dialog.Content
          className="dialog-popup-top fixed left-1/2 top-[18vh] z-[60] flex w-[640px] max-w-[94vw] -translate-x-1/2 flex-col overflow-hidden rounded-xl2 border border-line bg-surface shadow-pop outline-none"
          onKeyDown={onKeyDown}
        >
          <Dialog.Title className="sr-only">命令面板</Dialog.Title>
          <Dialog.Description className="sr-only">
            输入命令或搜索会话，方向键选择，回车执行
          </Dialog.Description>

          {paneView === 'commands' ? (
            <>
              <div className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3">
                <CommandIcon size={15} className="text-ink-5" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActiveIdx(0);
                  }}
                  placeholder="输入命令或搜索会话…"
                  className="flex-1 bg-transparent text-[14px] text-ink-1 placeholder:text-ink-5 outline-none"
                />
                <span className="rounded border border-line bg-surface-sub px-1.5 py-0.5 text-[10px] font-medium text-ink-5">
                  Esc
                </span>
              </div>

              <div ref={listRef} className="max-h-[60vh] min-h-[140px] overflow-y-auto py-2">
                {groupedCommands.length === 0 && hits.length === 0 && (
                  <div className="px-4 py-8 text-center text-[12px] text-ink-5">
                    {searching ? '搜索中…' : '没有匹配的命令'}
                  </div>
                )}

                {groupedCommands.map(([group, items]) => (
                  <div key={group} className="mb-1">
                    <div className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-ink-5">
                      {group}
                    </div>
                    {items.map((cmd) => {
                      const flatIdx = flatIndexFor.get(cmd.id);
                      const active = flatIdx === activeIdx && !cmd.disabled;
                      return (
                        <button
                          key={cmd.id}
                          data-idx={flatIdx}
                          disabled={cmd.disabled}
                          onMouseEnter={() => {
                            if (typeof flatIdx === 'number') setActiveIdx(flatIdx);
                          }}
                          onClick={() => executeCommand(cmd)}
                          className={clsx(
                            'flex w-full items-center gap-3 px-4 py-2 text-left text-[13px] transition',
                            cmd.disabled
                              ? 'cursor-not-allowed text-ink-5 opacity-60'
                              : active
                                ? 'bg-brand-500/15 text-ink-1'
                                : 'text-ink-2 hover:bg-surface-hover'
                          )}
                        >
                          <span
                            className={clsx(
                              'flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
                              active && !cmd.disabled
                                ? 'bg-brand-500/20 text-brand-600 ring-1 ring-brand-500/30'
                                : 'bg-surface-sub text-ink-4'
                            )}
                          >
                            {cmd.icon}
                          </span>
                          <span className="flex-1 truncate">{cmd.label}</span>
                          {cmd.hint && (
                            <span className="rounded border border-line bg-surface-sub px-1.5 py-0.5 text-[10px] font-medium text-ink-5">
                              {cmd.hint}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}

                {(hits.length > 0 || (searching && query.trim().length >= 2)) && (
                  <div className="mb-1">
                    <div className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-ink-5">
                      会话{searching ? ' · 搜索中…' : ''}
                    </div>
                    {hits.map((hit, i) => {
                      const flatIdx = enabledCommands.length + i;
                      const active = flatIdx === activeIdx;
                      return (
                        <button
                          key={hit.sessionPath}
                          data-idx={flatIdx}
                          onMouseEnter={() => setActiveIdx(flatIdx)}
                          onClick={() => openSessionFromHit(hit)}
                          className={clsx(
                            'flex w-full items-start gap-3 px-4 py-2 text-left transition',
                            active ? 'bg-brand-500/15' : 'hover:bg-surface-hover'
                          )}
                        >
                          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-sub">
                            <img
                              src={hit.source === 'claude' ? claudeIcon : codexIcon}
                              alt=""
                              className="h-3.5 w-3.5"
                              draggable={false}
                            />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium text-ink-1">
                              {hit.projectLabel}
                            </span>
                            <span className="mt-0.5 line-clamp-1 block text-[11.5px] text-ink-4">
                              {highlightTerms(hit.matches[0]?.excerpt ?? '', query)}
                            </span>
                          </span>
                          <ArrowRight size={13} className="mt-1 shrink-0 text-ink-5" />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          ) : (
            <ShortcutsHelp onBack={() => setPaneView('commands')} />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ShortcutsHelp({ onBack }: { onBack: () => void }): JSX.Element {
  return (
    <>
      <div className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3">
        <Keyboard size={15} className="text-ink-5" />
        <span className="flex-1 text-[14px] font-semibold text-ink-1">键盘快捷键</span>
        <button
          onClick={onBack}
          className="rounded border border-line bg-surface-sub px-2 py-0.5 text-[11px] font-medium text-ink-4 hover:text-ink-1"
        >
          ← 返回命令
        </button>
      </div>
      <div className="max-h-[60vh] overflow-y-auto px-4 py-3">
        <div className="divide-y divide-line">
          {SHORTCUT_TABLE.map((row) => (
            <div key={row.keys} className="flex items-center justify-between py-2">
              <span className="text-[12.5px] text-ink-2">{row.desc}</span>
              <span className="rounded border border-line bg-surface-sub px-2 py-0.5 font-mono text-[11px] text-ink-3">
                {row.keys}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-ink-5">
          在 macOS 上 Ctrl 等价为 Cmd。Ctrl+R 走系统默认行为（开发期重载窗口），不在 app 内拦截。
        </p>
      </div>
    </>
  );
}
