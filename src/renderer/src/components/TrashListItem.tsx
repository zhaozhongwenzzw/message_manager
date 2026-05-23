import { Folder, MessageSquare, RotateCcw, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import type { TrashEntry } from '../types';

type Props = {
  entry: TrashEntry;
  selected: boolean;
  onToggleSelect: () => void;
  onRestore: () => void;
  onPurge: () => void;
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = Date.now();
  const diffMin = Math.floor((now - ts) / 60_000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay} 天前`;
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function avatarTone(label: string): string {
  const palette = [
    'bg-brand-50 text-brand-700',
    'bg-info-50 text-info-600',
    'bg-warn-50 text-warn-600',
    'bg-agent-50 text-agent-600',
    'bg-rose-50 text-rose-600',
    'bg-sky-50 text-sky-600',
    'bg-teal-50 text-teal-600',
    'bg-indigo-50 text-indigo-600'
  ];
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

function initials(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return '?';
  return /[a-zA-Z]/.test(trimmed[0]) ? trimmed[0].toUpperCase() : trimmed[0];
}

export default function TrashListItem({
  entry,
  selected,
  onToggleSelect,
  onRestore,
  onPurge
}: Props): JSX.Element {
  const isProject = entry.kind === 'project';
  return (
    <div
      className={clsx(
        'group flex items-start gap-3 rounded-xl2 border px-4 py-3 transition',
        selected
          ? 'border-brand-200 bg-brand-50/40 shadow-card'
          : 'border-line bg-surface hover:border-line-strong hover:shadow-card-hover'
      )}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleSelect();
        }}
        className={clsx(
          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition',
          selected
            ? 'border-brand bg-brand text-white'
            : 'border-line-strong bg-surface hover:border-brand'
        )}
        title={selected ? '取消选择' : '选中'}
      >
        {selected && (
          <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2 6l3 3 5-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      <div
        className={clsx(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold',
          isProject ? 'bg-agent-50 text-agent-600 ring-1 ring-agent-100' : avatarTone(entry.originalLabel)
        )}
      >
        {isProject ? <Folder size={16} /> : initials(entry.originalLabel)}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[13px] font-semibold text-ink-1">
            {entry.originalLabel}
          </span>
          {isProject && (
            <span className="rounded-md bg-agent-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-agent-600">
              整个项目
            </span>
          )}
          <span
            className={clsx(
              'rounded-md px-1.5 py-0.5 text-[10px] font-medium',
              entry.source === 'claude'
                ? 'bg-brand-50 text-brand-600'
                : 'bg-info-50 text-info-600'
            )}
          >
            {entry.source === 'claude' ? 'Claude' : 'Codex'}
          </span>
          <span className="ml-auto shrink-0 text-[11px] text-ink-5">
            删除于 {formatTime(entry.deletedAt)}
          </span>
        </div>
        {entry.preview && (
          <div className="mt-1 line-clamp-1 text-[13px] text-ink-3">{entry.preview}</div>
        )}
        <div className="mt-1.5 flex items-center gap-2 text-[10.5px] text-ink-5">
          {isProject ? (
            <span className="inline-flex items-center gap-1">
              <Folder size={10} />
              {entry.childCount ?? 0} 个文件
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <MessageSquare size={10} />
              {entry.messageCount ?? 0} 条
            </span>
          )}
          <span className="opacity-50">·</span>
          <span>{formatSize(entry.size)}</span>
          <span className="opacity-50">·</span>
          <span className="truncate font-mono opacity-80" title={entry.originalPath}>
            {entry.originalPath}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRestore();
          }}
          className="flex h-8 items-center gap-1.5 rounded-md border border-brand-100 bg-brand-50 px-2.5 text-[12px] font-medium text-brand-700 transition hover:border-brand-200 hover:bg-brand-100"
          title="恢复到原位置"
        >
          <RotateCcw size={13} />
          恢复
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPurge();
          }}
          className="flex h-8 w-8 items-center justify-center rounded-md text-ink-5 transition hover:bg-danger-50 hover:text-danger-500"
          title="彻底删除"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
