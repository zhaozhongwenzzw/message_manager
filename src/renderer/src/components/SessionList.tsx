import { Search, Star } from 'lucide-react';
import clsx from 'clsx';
import type { SessionSummary } from '../types';
import SessionListItem from './SessionListItem';

type Props = {
  sessions: SessionSummary[];
  stars: Record<string, boolean>;
  query: string;
  onQuery: (q: string) => void;
  starredOnly: boolean;
  onToggleStarredOnly: () => void;
  onOpen: (s: SessionSummary) => void;
  onDelete: (s: SessionSummary) => void;
  onToggleStar: (s: SessionSummary) => void;
  loading: boolean;
};

export default function SessionList({
  sessions,
  stars,
  query,
  onQuery,
  starredOnly,
  onToggleStarredOnly,
  onOpen,
  onDelete,
  onToggleStar,
  loading
}: Props): JSX.Element {
  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-line bg-surface px-5 py-3">
        <div className="flex flex-1 items-center gap-2 rounded-lg border border-line bg-surface-sub px-3 py-1.5 transition focus-within:border-brand focus-within:bg-white">
          <Search size={14} className="text-ink-5" />
          <input
            type="text"
            placeholder="搜索预览 / 项目 / 会话 ID"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            className="flex-1 bg-transparent text-[13px] text-ink-1 placeholder:text-ink-5 outline-none"
          />
          {query && (
            <button
              onClick={() => onQuery('')}
              className="text-[11px] text-ink-5 hover:text-ink-2"
            >
              清空
            </button>
          )}
        </div>
        <button
          onClick={onToggleStarredOnly}
          className={clsx(
            'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition',
            starredOnly
              ? 'border-warn-500 bg-warn-50 text-warn-600'
              : 'border-line bg-surface text-ink-3 hover:border-line-strong hover:text-ink-1'
          )}
          title="只显示加星的会话"
        >
          <Star
            size={13}
            className={starredOnly ? 'fill-warn-500 text-warn-500' : 'text-ink-5'}
          />
          仅看收藏
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {loading && sessions.length === 0 && (
          <div className="py-16 text-center text-sm text-ink-5">扫描中...</div>
        )}
        {!loading && sessions.length === 0 && (
          <div className="py-16 text-center text-sm text-ink-5">没有匹配的会话</div>
        )}
        <div className="space-y-2.5">
          {sessions.map((s) => (
            <SessionListItem
              key={s.path}
              session={s}
              starred={!!stars[s.path]}
              onOpen={() => onOpen(s)}
              onDelete={() => onDelete(s)}
              onToggleStar={() => onToggleStar(s)}
            />
          ))}
        </div>
      </div>
      <div className="border-t border-line bg-surface px-5 py-2 text-[11px] text-ink-5">
        {sessions.length} 条会话
      </div>
    </section>
  );
}
