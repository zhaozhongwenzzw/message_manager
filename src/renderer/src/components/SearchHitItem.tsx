import { Archive, ArchiveRestore, Hash, MessageSquare, Sparkles, Star, Trash2, User, Wrench } from 'lucide-react';
import clsx from 'clsx';
import type { SearchHit, SearchMatch } from '../types';
import { highlightTerms } from '../utils/highlight';

type Props = {
  hit: SearchHit;
  query: string;
  starred: boolean;
  archived?: boolean;
  onOpen: (firstMatchIndex?: number) => void;
  onDelete: () => void;
  onToggleStar: () => void;
  onSummarize?: () => void;
  onArchive?: () => void;
};

function formatTime(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    year: sameYear ? undefined : '2-digit'
  });
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

function kindIcon(kind: SearchMatch['kind']): JSX.Element {
  const cls = 'h-3 w-3 shrink-0';
  if (kind === 'user') return <User size={10} className={clsx(cls, 'text-info-600')} />;
  if (kind === 'assistant') return <Sparkles size={10} className={clsx(cls, 'text-brand-600')} />;
  if (kind === 'thinking') return <span className={clsx(cls, 'rounded-full bg-ink-5/40')} />;
  return <Wrench size={10} className={clsx(cls, 'text-warn-600')} />;
}

function kindLabel(kind: SearchMatch['kind']): string {
  if (kind === 'user') return '用户';
  if (kind === 'assistant') return '助手';
  if (kind === 'thinking') return '思考';
  if (kind === 'tool_use') return '工具调用';
  if (kind === 'tool_result') return '工具结果';
  return kind;
}

export default function SearchHitItem({
  hit,
  query,
  starred,
  archived,
  onOpen,
  onDelete,
  onToggleStar,
  onSummarize,
  onArchive
}: Props): JSX.Element {
  const top = hit.matches.slice(0, 3);
  return (
    <div
      onClick={() => onOpen(hit.matches[0]?.eventIndex)}
      className={clsx(
        'group flex cursor-pointer items-start gap-3 rounded-xl2 border border-line bg-surface px-4 py-3 transition hover:border-line-strong hover:shadow-card-hover',
        archived && 'opacity-70'
      )}
    >
      <div
        className={clsx(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold',
          avatarTone(hit.projectLabel)
        )}
      >
        {initials(hit.projectLabel)}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[13px] font-semibold text-ink-1">
            {highlightTerms(hit.projectLabel, query)}
          </span>
          <span
            className={clsx(
              'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
              hit.source === 'claude'
                ? 'bg-brand-50 text-brand-700'
                : 'bg-info-50 text-info-700'
            )}
          >
            {hit.source}
          </span>
          {archived && (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-ink-1/5 px-1.5 py-0.5 text-[10px] font-medium text-ink-4">
              <Archive size={9} />
              已归档
            </span>
          )}
          {hit.ts && <span className="text-[11px] text-ink-5">{formatTime(hit.ts)}</span>}
        </div>

        <div className="mt-1.5 space-y-1">
          {top.map((m) => (
            <div
              key={m.eventIndex}
              className="flex items-start gap-1.5 text-[12px] leading-relaxed text-ink-3"
            >
              <span className="mt-0.5 flex items-center" title={kindLabel(m.kind)}>
                {kindIcon(m.kind)}
              </span>
              <span className="line-clamp-2 min-w-0 flex-1">
                {highlightTerms(m.excerpt, query)}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-1.5 flex items-center gap-2 text-[10.5px] text-ink-5">
          <span className="inline-flex items-center gap-1">
            <MessageSquare size={10} />
            {hit.matches.length} 处命中
          </span>
          <span className="opacity-50">·</span>
          <span className="inline-flex items-center gap-1 font-mono">
            <Hash size={10} />
            {hit.sessionPath.split(/[\\/]/).pop()?.slice(0, 12)}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {onSummarize && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSummarize();
            }}
            className="flex h-8 w-8 items-center justify-center rounded-md text-ink-5 opacity-0 transition hover:bg-brand-50 hover:text-brand-600 group-hover:opacity-100"
            title="生成续聊简报（AI 压缩上下文）"
          >
            <Sparkles size={15} />
          </button>
        )}
        {onArchive && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onArchive();
            }}
            className="flex h-8 w-8 items-center justify-center rounded-md text-ink-5 opacity-0 transition hover:bg-info-50 hover:text-info-600 group-hover:opacity-100"
            title={archived ? '取消归档（移回 sessions/）' : '归档（移到 Codex archived_sessions/）'}
          >
            {archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleStar();
          }}
          className={clsx(
            'flex h-8 w-8 items-center justify-center rounded-md transition',
            starred
              ? 'text-warn-500 hover:bg-warn-50'
              : 'text-ink-5 opacity-0 hover:bg-warn-50 hover:text-warn-500 group-hover:opacity-100'
          )}
          title={starred ? '取消收藏' : '加星收藏'}
        >
          <Star size={15} className={starred ? 'fill-current' : ''} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="flex h-8 w-8 items-center justify-center rounded-md text-ink-5 opacity-0 transition hover:bg-danger-50 hover:text-danger-500 group-hover:opacity-100"
          title="删除（软删除到回收站）"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );
}
