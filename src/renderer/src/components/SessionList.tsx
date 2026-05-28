import { Search, Star } from 'lucide-react';
import { useEffect, useRef } from 'react';
import clsx from 'clsx';
import type { SearchHit, SessionSummary } from '../types';
import SessionListItem from './SessionListItem';
import SearchHitItem from './SearchHitItem';

type Props = {
  sessions: SessionSummary[];
  stars: Record<string, boolean>;
  query: string;
  onQuery: (q: string) => void;
  starredOnly: boolean;
  onToggleStarredOnly: () => void;
  onOpen: (s: SessionSummary, jumpToEvent?: number, highlightQuery?: string) => void;
  onDelete: (s: SessionSummary) => void;
  onToggleStar: (s: SessionSummary) => void;
  onSummarize: (s: SessionSummary) => void;
  onArchive?: (s: SessionSummary) => void;
  onOpenTerminal?: (s: SessionSummary) => void;
  loading: boolean;
  searchHits: SearchHit[] | null;
  searching: boolean;
  searchError: string | null;
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
  onSummarize,
  onArchive,
  onOpenTerminal,
  loading,
  searchHits,
  searching,
  searchError
}: Props): JSX.Element {
  const inSearchMode = searchHits !== null;
  const hits = searchHits ?? [];
  const hitMap = new Map(sessions.map((s) => [s.path, s]));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onFocus = (): void => {
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener('recall:focus-search', onFocus);
    return () => window.removeEventListener('recall:focus-search', onFocus);
  }, []);

  const visibleCount = inSearchMode ? hits.length : sessions.length;
  const placeholder = inSearchMode
    ? '搜索会话正文 / 工具结果 / 项目'
    : '搜索预览 / 项目 / 会话 ID';

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-line bg-surface px-5 py-3">
        <div className="flex flex-1 items-center gap-2 rounded-lg border border-line bg-surface-sub px-3 py-1.5 transition focus-within:border-brand focus-within:bg-surface">
          <Search size={14} className={clsx('text-ink-5', searching && 'animate-pulse text-brand-500')} />
          <input
            ref={inputRef}
            type="text"
            placeholder={placeholder}
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
        {searchError && (
          <div className="mb-3 rounded-lg border border-danger-100 bg-danger-50 px-3 py-2 text-[12px] text-danger-600">
            {searchError}
          </div>
        )}
        {loading && sessions.length === 0 && !inSearchMode && (
          <div className="py-16 text-center text-sm text-ink-5">扫描中...</div>
        )}
        {searching && hits.length === 0 && (
          <div className="py-16 text-center text-sm text-ink-5">搜索中...</div>
        )}
        {!loading && !searching && inSearchMode && hits.length === 0 && (
          <div className="py-16 text-center text-sm text-ink-5">没有匹配的内容</div>
        )}
        {!loading && !inSearchMode && sessions.length === 0 && (
          <div className="py-16 text-center text-sm text-ink-5">没有匹配的会话</div>
        )}
        <div className="space-y-2.5">
          {inSearchMode
            ? hits.map((h) => {
                const sess = hitMap.get(h.sessionPath);
                const isArchived = sess?.archived ?? h.sessionPath.includes('archived_sessions');
                return (
                  <SearchHitItem
                    key={h.sessionPath}
                    hit={h}
                    query={query}
                    starred={!!stars[h.sessionPath]}
                    archived={isArchived}
                    hasCwd={!!sess?.cwd?.trim()}
                    onOpen={(idx) => {
                      if (sess) onOpen(sess, idx, query);
                      else
                        onOpen(
                          {
                            source: h.source,
                            path: h.sessionPath,
                            id: h.sessionPath.split(/[\\/]/).pop() ?? '',
                            preview: h.matches[0]?.excerpt ?? '',
                            timestamp: h.ts ?? 0,
                            size: 0,
                            messageCount: 0,
                            projectKey: h.projectKey,
                            projectLabel: h.projectLabel
                          },
                          idx,
                          query
                        );
                    }}
                    onDelete={() => {
                      if (sess) onDelete(sess);
                    }}
                    onToggleStar={() => {
                      if (sess) onToggleStar(sess);
                    }}
                    onSummarize={() => {
                      const target: SessionSummary =
                        sess ?? {
                          source: h.source,
                          path: h.sessionPath,
                          id: h.sessionPath.split(/[\\/]/).pop() ?? '',
                          preview: h.matches[0]?.excerpt ?? '',
                          timestamp: h.ts ?? 0,
                          size: 0,
                          messageCount: 0,
                          projectKey: h.projectKey,
                          projectLabel: h.projectLabel
                        };
                      onSummarize(target);
                    }}
                    onArchive={
                      onArchive && h.source === 'codex'
                        ? () => {
                            const target: SessionSummary =
                              sess ?? {
                                source: h.source,
                                path: h.sessionPath,
                                id: h.sessionPath.split(/[\\/]/).pop() ?? '',
                                preview: h.matches[0]?.excerpt ?? '',
                                timestamp: h.ts ?? 0,
                                size: 0,
                                messageCount: 0,
                                projectKey: h.projectKey,
                                projectLabel: h.projectLabel,
                                archived: isArchived
                              };
                            onArchive(target);
                          }
                        : undefined
                    }
                    onOpenTerminal={
                      onOpenTerminal && sess
                        ? () => onOpenTerminal(sess)
                        : undefined
                    }
                  />
                );
              })
            : sessions.map((s) => (
                <SessionListItem
                  key={s.path}
                  session={s}
                  starred={!!stars[s.path]}
                  onOpen={() => onOpen(s)}
                  onDelete={() => onDelete(s)}
                  onToggleStar={() => onToggleStar(s)}
                  onSummarize={() => onSummarize(s)}
                  onArchive={onArchive && s.source === 'codex' ? () => onArchive(s) : undefined}
                  onOpenTerminal={onOpenTerminal ? () => onOpenTerminal(s) : undefined}
                />
              ))}
        </div>
      </div>
      <div className="border-t border-line bg-surface px-5 py-2 text-[11px] text-ink-5">
        {inSearchMode
          ? `${visibleCount} 个会话命中`
          : `${visibleCount} 条会话`}
      </div>
    </section>
  );
}
