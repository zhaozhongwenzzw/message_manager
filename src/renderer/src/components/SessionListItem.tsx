import { Archive, ArchiveRestore, Hash, MessageSquare, Sparkles, Star, StickyNote, Tag, Terminal, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import type { SessionSummary } from '../types';
import { avatarTone, tagChipTone } from '../utils/tone';
import TagNotePopover from './TagNotePopover';

type Props = {
  session: SessionSummary;
  starred: boolean;
  tags: string[];
  note: string;
  allTags: string[];
  onOpen: () => void;
  onDelete: () => void;
  onToggleStar: () => void;
  onSetTags: (tags: string[]) => void;
  onSetNote: (note: string) => void;
  onSummarize?: () => void;
  onArchive?: () => void; // codex only
  onOpenTerminal?: () => void;
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay)
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    year: sameYear ? undefined : '2-digit'
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function avatarInitial(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return '?';
  return /[a-zA-Z]/.test(trimmed[0]) ? trimmed[0].toUpperCase() : trimmed[0];
}

export default function SessionListItem({
  session,
  starred,
  tags,
  note,
  allTags,
  onOpen,
  onDelete,
  onToggleStar,
  onSetTags,
  onSetNote,
  onSummarize,
  onArchive,
  onOpenTerminal
}: Props): JSX.Element {
  const preview = session.preview || '(空会话)';
  const isArchived = !!session.archived;
  const hasCwd = !!session.cwd?.trim();
  const hasMeta = tags.length > 0 || !!note.trim();
  return (
    <div
      onClick={onOpen}
      className={clsx(
        'group flex cursor-pointer items-start gap-3 rounded-xl2 border border-line bg-surface px-4 py-3 transition hover:border-line-strong hover:shadow-card-hover',
        isArchived && 'opacity-70'
      )}
    >
      <div
        className={clsx(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold',
          avatarTone(session.projectLabel)
        )}
      >
        {avatarInitial(session.projectLabel)}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[13px] font-semibold text-ink-1">{session.projectLabel}</span>
          {isArchived && (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-ink-1/5 px-1.5 py-0.5 text-[10px] font-medium text-ink-4">
              <Archive size={9} />
              已归档
            </span>
          )}
          <span className="text-[11px] text-ink-5">{formatTime(session.timestamp)}</span>
        </div>
        <div className="mt-1 line-clamp-1 text-[13px] text-ink-3">{preview}</div>
        <div className="mt-1.5 flex items-center gap-2 text-[10.5px] text-ink-5">
          <span className="inline-flex items-center gap-1">
            <MessageSquare size={10} />
            {session.messageCount} 条
          </span>
          <span className="opacity-50">·</span>
          <span>{formatSize(session.size)}</span>
          <span className="opacity-50">·</span>
          <span className="inline-flex items-center gap-1 font-mono">
            <Hash size={10} />
            {session.id.slice(0, 8)}
          </span>
        </div>
        {hasMeta && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {tags.map((t) => (
              <span
                key={t}
                className={clsx(
                  'inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium',
                  tagChipTone(t)
                )}
              >
                {t}
              </span>
            ))}
            {note.trim() && (
              <span className="inline-flex max-w-full items-center gap-1 text-[11px] italic text-ink-4">
                <StickyNote size={10} className="shrink-0" />
                <span className="truncate">{note.trim()}</span>
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {onOpenTerminal && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (!hasCwd) return;
              onOpenTerminal();
            }}
            disabled={!hasCwd}
            className="flex h-8 w-8 items-center justify-center rounded-md text-ink-5 opacity-0 transition hover:bg-info-50 hover:text-info-600 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-ink-5 group-hover:opacity-100"
            title={
              hasCwd
                ? `在终端 resume（${session.source === 'claude' ? 'claude --resume' : 'codex resume'}）`
                : '会话未记录工作目录，无法 resume'
            }
          >
            <Terminal size={15} />
          </button>
        )}
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
            title={isArchived ? '取消归档（移回 sessions/）' : '归档（移到 Codex archived_sessions/）'}
          >
            {isArchived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
          </button>
        )}
        <TagNotePopover
          tags={tags}
          note={note}
          allTags={allTags}
          onSetTags={onSetTags}
          onSetNote={onSetNote}
        >
          <button
            onClick={(e) => e.stopPropagation()}
            className={clsx(
              'flex h-8 w-8 items-center justify-center rounded-md transition hover:bg-agent-50 hover:text-agent-600',
              hasMeta
                ? 'text-agent-600'
                : 'text-ink-5 opacity-0 group-hover:opacity-100'
            )}
            title="标签 / 备注"
          >
            <Tag size={15} />
          </button>
        </TagNotePopover>
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
