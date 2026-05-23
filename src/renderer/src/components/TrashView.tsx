import { useCallback, useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowLeft,
  CircleAlert,
  ExternalLink,
  Filter,
  Folder,
  Inbox,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  X
} from 'lucide-react';
import clsx from 'clsx';
import { api } from '../api';
import type { TrashEntry } from '../types';
import { useConfirm } from './ConfirmDialog';
import TrashListItem from './TrashListItem';

type Props = {
  onBack: () => void;
  onAfterRestore: () => void;
};

type FilterKey = 'all' | 'claude' | 'codex' | 'project';

type ConflictState = {
  entry: TrashEntry;
  originalPath: string;
  resolve: (mode: 'overwrite' | 'rename' | 'cancel') => void;
};

export default function TrashView({ onBack, onAfterRestore }: Props): JSX.Element {
  const confirm = useConfirm();
  const [entries, setEntries] = useState<TrashEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [conflict, setConflict] = useState<ConflictState | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.trashList();
      setEntries(list);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Drop selection of items no longer in the list (after restore/purge/refresh).
  useEffect(() => {
    setSelected((prev) => {
      const ids = new Set(entries.map((e) => e.id));
      const next = new Set<string>();
      for (const id of prev) if (ids.has(id)) next.add(id);
      return next;
    });
  }, [entries]);

  const counts = useMemo(() => {
    const c = { all: entries.length, claude: 0, codex: 0, project: 0 };
    for (const e of entries) {
      if (e.source === 'claude') c.claude++;
      else c.codex++;
      if (e.kind === 'project') c.project++;
    }
    return c;
  }, [entries]);

  const filtered = useMemo(() => {
    let list = entries;
    if (filter === 'claude') list = list.filter((e) => e.source === 'claude');
    else if (filter === 'codex') list = list.filter((e) => e.source === 'codex');
    else if (filter === 'project') list = list.filter((e) => e.kind === 'project');
    const q = query.trim().toLowerCase();
    if (q)
      list = list.filter(
        (e) =>
          e.originalLabel.toLowerCase().includes(q) ||
          (e.preview ?? '').toLowerCase().includes(q) ||
          e.originalPath.toLowerCase().includes(q)
      );
    return list;
  }, [entries, filter, query]);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllVisible = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = filtered.every((e) => next.has(e.id));
      if (allSelected) {
        for (const e of filtered) next.delete(e.id);
      } else {
        for (const e of filtered) next.add(e.id);
      }
      return next;
    });
  }, [filtered]);

  // Single restore — handles the conflict round-trip via the ConflictDialog.
  const restoreOne = useCallback(
    async (entry: TrashEntry, forcedMode?: 'overwrite' | 'rename'): Promise<boolean> => {
      try {
        const res = await api.trashRestore({
          trashPath: entry.trashPath,
          mode: forcedMode
        });
        if ('conflict' in res) {
          const conflictRes = res;
          const mode = await new Promise<'overwrite' | 'rename' | 'cancel'>((resolve) => {
            setConflict({ entry, originalPath: conflictRes.originalPath, resolve });
          });
          if (mode === 'cancel') return false;
          const res2 = await api.trashRestore({ trashPath: entry.trashPath, mode });
          return 'ok' in res2;
        }
        return res.ok;
      } catch (e: any) {
        setError(`恢复失败 (${entry.originalLabel}): ${e?.message ?? String(e)}`);
        return false;
      }
    },
    []
  );

  const handleRestore = useCallback(
    async (entry: TrashEntry) => {
      const ok = await restoreOne(entry);
      if (ok) {
        await refresh();
        onAfterRestore();
      }
    },
    [restoreOne, refresh, onAfterRestore]
  );

  const handlePurge = useCallback(
    async (entry: TrashEntry) => {
      const ok = await confirm({
        title: '彻底删除？',
        description: (
          <>
            <div>
              <span className="font-medium text-ink-1">{entry.originalLabel}</span>
              <span className="text-ink-5"> · 永久删除，不可恢复</span>
            </div>
            <div className="mt-1 text-[12px] text-ink-5">
              将从回收站移除：
              <div className="mt-1 truncate font-mono text-[11px] text-ink-4">{entry.trashPath}</div>
            </div>
          </>
        ),
        confirmLabel: '彻底删除',
        tone: 'danger'
      });
      if (!ok) return;
      try {
        await api.trashPurge(entry.trashPath);
        await refresh();
      } catch (e: any) {
        setError(`彻底删除失败: ${e?.message ?? String(e)}`);
      }
    },
    [confirm, refresh]
  );

  const handleRestoreSelected = useCallback(async () => {
    const targets = entries.filter((e) => selected.has(e.id));
    if (targets.length === 0) return;
    let restored = 0;
    let lastMode: 'overwrite' | 'rename' | null = null;
    let applyToAll = false;
    for (const entry of targets) {
      const mode: 'overwrite' | 'rename' | undefined =
        applyToAll && lastMode ? lastMode : undefined;
      try {
        const first = await api.trashRestore({ trashPath: entry.trashPath, mode });
        if ('conflict' in first) {
          const conflictRes = first;
          const choice = await new Promise<'overwrite' | 'rename' | 'cancel'>((resolve) => {
            setConflict({ entry, originalPath: conflictRes.originalPath, resolve });
          });
          if (choice === 'cancel') continue;
          lastMode = choice;
          // After the first explicit choice in a batch, apply it to the rest.
          applyToAll = true;
          const second = await api.trashRestore({ trashPath: entry.trashPath, mode: choice });
          if ('ok' in second) restored++;
        } else if (first.ok) {
          restored++;
        }
      } catch (e: any) {
        setError(`批量恢复中失败: ${e?.message ?? String(e)}`);
      }
    }
    if (restored > 0) {
      await refresh();
      onAfterRestore();
    }
    setSelected(new Set());
  }, [entries, selected, refresh, onAfterRestore]);

  const handlePurgeSelected = useCallback(async () => {
    const targets = entries.filter((e) => selected.has(e.id));
    if (targets.length === 0) return;
    const ok = await confirm({
      title: `彻底删除选中的 ${targets.length} 项？`,
      description: '永久删除，无法从回收站恢复。',
      confirmLabel: '彻底删除',
      tone: 'danger'
    });
    if (!ok) return;
    for (const entry of targets) {
      try {
        await api.trashPurge(entry.trashPath);
      } catch (e: any) {
        setError(`彻底删除中失败: ${e?.message ?? String(e)}`);
      }
    }
    await refresh();
    setSelected(new Set());
  }, [entries, selected, confirm, refresh]);

  const handleEmpty = useCallback(async () => {
    if (entries.length === 0) return;
    const ok = await confirm({
      title: '清空整个回收站？',
      description: (
        <>
          <div>共 <span className="font-medium text-ink-1">{entries.length}</span> 项将被永久删除。</div>
          <div className="mt-2 text-[12px] text-ink-5">
            此操作不可撤销，请确认所有项目都不再需要。
          </div>
        </>
      ),
      confirmLabel: '清空回收站',
      tone: 'danger'
    });
    if (!ok) return;
    try {
      await api.trashEmpty();
      await refresh();
    } catch (e: any) {
      setError(`清空失败: ${e?.message ?? String(e)}`);
    }
  }, [entries.length, confirm, refresh]);

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((e) => selected.has(e.id));

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas">
      {/* Toolbar */}
      <div className="flex items-center gap-3 border-b border-line bg-surface px-5 py-3">
        <button
          onClick={onBack}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[12.5px] font-medium text-ink-3 transition hover:border-line-strong hover:text-ink-1"
        >
          <ArrowLeft size={14} />
          返回
        </button>
        <div className="flex items-baseline gap-2">
          <span className="text-[15px] font-semibold text-ink-1">回收站</span>
          <span className="text-[12px] text-ink-5">{entries.length} 项</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => api.openTrash()}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[12px] text-ink-3 transition hover:border-line-strong hover:text-ink-1"
            title="在系统文件管理器中打开回收站目录"
          >
            <ExternalLink size={13} />
            在文件管理器中打开
          </button>
          <button
            onClick={refresh}
            disabled={loading}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface text-ink-3 transition hover:border-line-strong hover:text-ink-1 disabled:opacity-50"
            title="刷新"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={handleEmpty}
            disabled={entries.length === 0}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-danger-100 bg-danger-50 px-3 text-[12px] font-medium text-danger-600 transition hover:border-danger-500/40 disabled:cursor-not-allowed disabled:opacity-50"
            title="清空整个回收站（不可恢复）"
          >
            <Trash2 size={13} />
            清空回收站
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 border-b border-danger-100 bg-danger-50 px-4 py-2 text-sm text-danger-600">
          <CircleAlert size={14} />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="rounded px-2 py-0.5 text-xs hover:bg-surface">
            关闭
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Sidebar filters */}
        <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-surface-sub">
          <div className="flex items-center gap-2 px-5 pt-5 pb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-5">
            <Filter size={12} />
            <span>筛选</span>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pt-1 pb-3">
            <FilterRow
              icon={<Inbox size={14} />}
              label="全部"
              count={counts.all}
              active={filter === 'all'}
              onClick={() => setFilter('all')}
            />
            <div className="my-2 h-px bg-line" />
            <FilterRow
              icon={<span className="text-[10px] font-semibold">C</span>}
              label="Claude"
              count={counts.claude}
              active={filter === 'claude'}
              onClick={() => setFilter('claude')}
              tone="bg-brand-50 text-brand-700"
            />
            <FilterRow
              icon={<span className="text-[10px] font-semibold">X</span>}
              label="Codex"
              count={counts.codex}
              active={filter === 'codex'}
              onClick={() => setFilter('codex')}
              tone="bg-info-50 text-info-600"
            />
            <div className="my-2 h-px bg-line" />
            <FilterRow
              icon={<Folder size={14} />}
              label="整个项目"
              count={counts.project}
              active={filter === 'project'}
              onClick={() => setFilter('project')}
              tone="bg-agent-50 text-agent-600"
            />
          </div>
        </aside>

        {/* List */}
        <section className="relative flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-3 border-b border-line bg-surface px-5 py-3">
            <div className="flex flex-1 items-center gap-2 rounded-lg border border-line bg-surface-sub px-3 py-1.5 transition focus-within:border-brand focus-within:bg-surface">
              <Search size={14} className="text-ink-5" />
              <input
                type="text"
                placeholder="搜索预览 / 项目 / 路径"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="flex-1 bg-transparent text-[13px] text-ink-1 placeholder:text-ink-5 outline-none"
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  className="text-[11px] text-ink-5 hover:text-ink-2"
                >
                  清空
                </button>
              )}
            </div>
            {filtered.length > 0 && (
              <button
                onClick={selectAllVisible}
                className={clsx(
                  'flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium transition',
                  allVisibleSelected
                    ? 'border-brand-200 bg-brand-50 text-brand-700'
                    : 'border-line bg-surface text-ink-3 hover:border-line-strong hover:text-ink-1'
                )}
              >
                {allVisibleSelected ? '取消全选' : '全选'}
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {loading && entries.length === 0 && (
              <div className="py-16 text-center text-sm text-ink-5">加载中…</div>
            )}
            {!loading && entries.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-ink-5">
                <Inbox size={28} className="text-ink-5/60" />
                <div>回收站是空的</div>
                <div className="text-[12px] text-ink-5/80">
                  在主视图中删除的会话会出现在这里
                </div>
              </div>
            )}
            {!loading && entries.length > 0 && filtered.length === 0 && (
              <div className="py-16 text-center text-sm text-ink-5">没有匹配的项</div>
            )}
            <div className="space-y-2.5 pb-24">
              {filtered.map((e) => (
                <TrashListItem
                  key={e.id}
                  entry={e}
                  selected={selected.has(e.id)}
                  onToggleSelect={() => toggleSelect(e.id)}
                  onRestore={() => handleRestore(e)}
                  onPurge={() => handlePurge(e)}
                />
              ))}
            </div>
          </div>

          {/* Selection actions bar */}
          {selected.size > 0 && (
            <div className="pointer-events-auto absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-xl2 border border-line bg-surface px-3 py-2 shadow-pop">
              <span className="px-2 text-[12.5px] font-medium text-ink-2">
                已选 <span className="tabular-nums text-ink-1">{selected.size}</span> 项
              </span>
              <span className="h-5 w-px bg-line" />
              <button
                onClick={handleRestoreSelected}
                className="flex h-8 items-center gap-1.5 rounded-md bg-brand px-3 text-[12.5px] font-semibold text-white transition hover:bg-brand-600"
              >
                <RotateCcw size={13} />
                恢复
              </button>
              <button
                onClick={handlePurgeSelected}
                className="flex h-8 items-center gap-1.5 rounded-md border border-danger-100 bg-danger-50 px-3 text-[12.5px] font-medium text-danger-600 transition hover:border-danger-500/40"
              >
                <Trash2 size={13} />
                彻底删除
              </button>
              <button
                onClick={() => setSelected(new Set())}
                className="flex h-8 w-8 items-center justify-center rounded-md text-ink-5 transition hover:bg-surface-hover hover:text-ink-1"
                title="取消选择"
              >
                <X size={14} />
              </button>
            </div>
          )}
        </section>
      </div>

      {/* Conflict resolution dialog */}
      <ConflictDialog
        state={conflict}
        onClose={(mode) => {
          if (conflict) conflict.resolve(mode);
          setConflict(null);
        }}
      />
    </div>
  );
}

function FilterRow({
  icon,
  label,
  count,
  active,
  onClick,
  tone
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  tone?: string;
}): JSX.Element {
  return (
    <div
      onClick={onClick}
      className={clsx(
        'mb-0.5 flex w-full cursor-pointer items-center gap-2.5 rounded-lg pl-2.5 pr-1.5 py-2 text-left text-[13px] transition',
        active
          ? 'bg-surface text-ink-1 shadow-card ring-1 ring-brand-100'
          : 'text-ink-3 hover:bg-surface/70 hover:text-ink-1'
      )}
    >
      <span
        className={clsx(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold',
          tone ?? 'bg-ink-1/5 text-ink-2'
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span
        className={clsx(
          'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium tabular-nums',
          active ? 'bg-brand-50 text-brand-600' : 'bg-surface text-ink-5'
        )}
      >
        {count}
      </span>
    </div>
  );
}

function ConflictDialog({
  state,
  onClose
}: {
  state: ConflictState | null;
  onClose: (mode: 'overwrite' | 'rename' | 'cancel') => void;
}): JSX.Element {
  return (
    <Dialog.Root open={!!state} onOpenChange={(o) => !o && onClose('cancel')}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay fixed inset-0 z-50 bg-ink-1/40 backdrop-blur-[2px]" />
        <Dialog.Content
          className="dialog-popup fixed left-1/2 top-1/2 z-50 w-[480px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-xl2 border border-line bg-surface p-5 shadow-pop outline-none"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-warn-50 text-warn-600 ring-1 ring-warn-100">
              <CircleAlert size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-[15px] font-semibold text-ink-1">
                原位置已被占用
              </Dialog.Title>
              <Dialog.Description asChild>
                <div className="mt-2 text-[13px] leading-relaxed text-ink-3">
                  <div>
                    <span className="font-medium text-ink-1">{state?.entry.originalLabel}</span>{' '}
                    要恢复到的位置已经存在文件：
                  </div>
                  <div className="mt-1.5 break-all rounded-md bg-surface-sub px-2 py-1.5 font-mono text-[11.5px] text-ink-4 ring-1 ring-line">
                    {state?.originalPath}
                  </div>
                  <div className="mt-2 text-[12px] text-ink-5">
                    可以覆盖原文件，或者把恢复的文件加 <code className="rounded bg-surface-sub px-1">.restored.&lt;时间戳&gt;</code> 后缀保留两份。
                  </div>
                </div>
              </Dialog.Description>
            </div>
          </div>
          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              onClick={() => onClose('cancel')}
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink-3 transition hover:border-line-strong hover:text-ink-1"
            >
              取消
            </button>
            <button
              onClick={() => onClose('rename')}
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink-2 transition hover:border-line-strong hover:text-ink-1"
            >
              重命名后恢复
            </button>
            <button
              onClick={() => onClose('overwrite')}
              className="rounded-lg bg-danger-500 px-3 py-1.5 text-[12.5px] font-semibold text-white transition hover:bg-danger-600"
            >
              覆盖原文件
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
