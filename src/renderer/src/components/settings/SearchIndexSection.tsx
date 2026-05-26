import { useEffect, useState } from 'react';
import { Database, Loader2, RefreshCw } from 'lucide-react';
import { api } from '../../api';
import type { SearchStatus } from '../../types';
import { useConfirm } from '../ConfirmDialog';

type Props = { open: boolean };

export default function SearchIndexSection({ open }: Props): JSX.Element {
  const [searchStatus, setSearchStatus] = useState<SearchStatus | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildResult, setRebuildResult] = useState<string | null>(null);
  const confirm = useConfirm();

  useEffect(() => {
    if (!open) return;
    setRebuildResult(null);
    void refreshSearchStatus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!searchStatus?.building) return;
    const t = window.setInterval(() => {
      void refreshSearchStatus();
    }, 1000);
    return () => window.clearInterval(t);
  }, [open, searchStatus?.building]);

  async function refreshSearchStatus(): Promise<void> {
    try {
      const s = await api.searchStatus();
      setSearchStatus(s);
    } catch {
      // ignore
    }
  }

  async function handleRebuild(): Promise<void> {
    const ok = await confirm({
      title: '重建搜索索引？',
      description: (
        <>
          <div>会扫描所有 Claude / Codex 会话并重新构建索引。</div>
          <div className="mt-1 text-[12px] text-ink-5">
            视会话数量大小，可能需要数秒到数分钟。期间搜索仍可用，但结果可能不全。
          </div>
        </>
      ),
      confirmLabel: '重建'
    });
    if (!ok) return;
    setRebuilding(true);
    setRebuildResult(null);
    try {
      const r = await api.searchRebuild();
      setRebuildResult(`已索引 ${r.added} 个会话，用时 ${(r.durationMs / 1000).toFixed(1)}s`);
      await refreshSearchStatus();
    } catch (e: any) {
      setRebuildResult(`失败: ${e?.message ?? String(e)}`);
    } finally {
      setRebuilding(false);
    }
  }

  return (
    <div className="rounded-xl2 border border-line bg-surface-sub p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[12px] font-medium text-ink-2">索引状态</div>
        {searchStatus?.building && (
          <span className="inline-flex items-center gap-1 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-600">
            <Loader2 size={10} className="animate-spin" />
            构建中
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <Database size={14} className="shrink-0 text-ink-4" />
        <div className="min-w-0 flex-1 text-[12px] text-ink-3">
          {searchStatus ? (
            <>
              <span className="font-medium text-ink-1 tabular-nums">
                {searchStatus.indexedSessions}
              </span>
              <span className="text-ink-5"> 个会话 · </span>
              <span className="font-medium text-ink-1 tabular-nums">
                {searchStatus.totalDocs}
              </span>
              <span className="text-ink-5"> 条事件</span>
              {searchStatus.buildProgress && (
                <span className="ml-2 text-ink-5">
                  ({searchStatus.buildProgress.done}/{searchStatus.buildProgress.total})
                </span>
              )}
              {searchStatus.lastBuildAt && (
                <span className="ml-2 text-[11px] text-ink-5">
                  · 上次构建 {new Date(searchStatus.lastBuildAt).toLocaleString('zh-CN')}
                </span>
              )}
            </>
          ) : (
            <span className="text-ink-5">加载中...</span>
          )}
        </div>
        <button
          onClick={() => void refreshSearchStatus()}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-ink-3 transition hover:border-line-strong hover:text-ink-1"
          title="刷新"
        >
          <RefreshCw size={12} />
        </button>
        <button
          onClick={() => void handleRebuild()}
          disabled={rebuilding}
          className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-line bg-surface px-2.5 text-[12px] text-ink-3 transition hover:border-brand hover:text-brand-600 disabled:opacity-50"
        >
          {rebuilding ? <Loader2 size={12} className="animate-spin" /> : <Database size={12} />}
          {rebuilding ? '构建中…' : '重建索引'}
        </button>
      </div>
      {rebuildResult && (
        <div className="mt-2 rounded border border-line bg-surface px-2.5 py-1.5 text-[11.5px] text-ink-3">
          {rebuildResult}
        </div>
      )}
      <div className="mt-2 text-[11px] leading-relaxed text-ink-4">
        索引存放在 ~/.claude-manager/search-index.json · 删除文件后下次启动会自动重建
      </div>
    </div>
  );
}
