import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import {
  Check,
  Database,
  ExternalLink,
  Loader2,
  Monitor,
  Moon,
  Pencil,
  RefreshCw,
  RotateCcw,
  Settings as SettingsIcon,
  Sun,
  Trash2,
  X
} from 'lucide-react';
import clsx from 'clsx';
import { api } from '../api';
import type { Appearance, SearchStatus } from '../types';
import { useConfirm } from './ConfirmDialog';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appearance: Appearance;
  onAppearanceChange: (a: Appearance) => void;
  trashDir: string | undefined;
  onTrashDirChange: (next: string | undefined) => void;
};

const OPTIONS: Array<{
  value: Appearance;
  label: string;
  desc: string;
  icon: React.ReactNode;
  preview: React.ReactNode;
}> = [
  {
    value: 'light',
    label: '浅色',
    desc: '白色简约，适合白天工作',
    icon: <Sun size={14} />,
    preview: <Preview tone="light" />
  },
  {
    value: 'dark',
    label: '深色',
    desc: '深色背景，长时间使用更护眼',
    icon: <Moon size={14} />,
    preview: <Preview tone="dark" />
  },
  {
    value: 'system',
    label: '跟随系统',
    desc: '随系统的浅/深色偏好自动切换',
    icon: <Monitor size={14} />,
    preview: <Preview tone="system" />
  }
];

export default function SettingsDialog({
  open,
  onOpenChange,
  appearance,
  onAppearanceChange,
  trashDir,
  onTrashDirChange
}: Props): JSX.Element {
  const [defaultPath, setDefaultPath] = useState<string>('');
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [searchStatus, setSearchStatus] = useState<SearchStatus | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildResult, setRebuildResult] = useState<string | null>(null);
  const confirm = useConfirm();

  useEffect(() => {
    if (!open) return;
    api.trashDefaultPath().then(setDefaultPath).catch(() => {});
    setErrMsg(null);
    setRebuildResult(null);
    void refreshSearchStatus();
  }, [open]);

  // Poll while the index is being built so the count keeps ticking up.
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

  const effectivePath = trashDir?.trim() || defaultPath;
  const isCustom = !!trashDir?.trim();

  async function handlePick(): Promise<void> {
    setErrMsg(null);
    const res = await api.pickFolder({
      defaultPath: effectivePath,
      title: '选择回收站文件夹'
    });
    if (!res) return; // cancelled
    if (res.error) {
      setErrMsg(res.error);
      return;
    }
    if (res.path) onTrashDirChange(res.path);
  }

  function handleReset(): void {
    setErrMsg(null);
    onTrashDirChange(undefined);
  }

  function handleOpen(): void {
    if (effectivePath) void api.revealPath(effectivePath);
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay fixed inset-0 z-50 bg-ink-1/40 backdrop-blur-[2px]" />
        <Dialog.Content className="dialog-popup fixed left-1/2 top-1/2 z-50 w-[600px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-xl2 border border-line bg-surface p-5 shadow-pop outline-none">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 ring-1 ring-brand-100">
              <SettingsIcon size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-[15px] font-semibold text-ink-1">设置</Dialog.Title>
              <Dialog.Description className="mt-1 text-[12.5px] text-ink-4">
                偏好保存在 ~/.claude-manager/config.json
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                className="-mr-1 -mt-1 flex h-7 w-7 items-center justify-center rounded-md text-ink-5 hover:bg-surface-hover hover:text-ink-1"
                title="关闭"
              >
                <X size={14} />
              </button>
            </Dialog.Close>
          </div>

          <div className="mt-5 max-h-[60vh] space-y-5 overflow-y-auto pr-1">
            {/* ── 外观主题 ───────────────────────────────────────── */}
            <section>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-5">
                外观主题
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                {OPTIONS.map((opt) => {
                  const active = appearance === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => onAppearanceChange(opt.value)}
                      className={clsx(
                        'group relative flex flex-col overflow-hidden rounded-xl2 border text-left transition',
                        active
                          ? 'border-brand bg-brand-50/40 ring-2 ring-brand-200'
                          : 'border-line bg-surface-sub hover:border-line-strong'
                      )}
                    >
                      <div className="px-3 pt-3">{opt.preview}</div>
                      <div className="flex items-center gap-1.5 px-3 pb-3 pt-2">
                        <span
                          className={clsx(
                            'flex items-center',
                            active ? 'text-brand-600' : 'text-ink-5'
                          )}
                        >
                          {opt.icon}
                        </span>
                        <span
                          className={clsx(
                            'text-[13px] font-semibold',
                            active ? 'text-ink-1' : 'text-ink-2'
                          )}
                        >
                          {opt.label}
                        </span>
                        {active && (
                          <span className="ml-auto flex h-5 w-5 items-center justify-center rounded-full bg-brand text-white">
                            <Check size={12} strokeWidth={3} />
                          </span>
                        )}
                      </div>
                      <div className="-mt-1 px-3 pb-3 text-[11px] leading-snug text-ink-4">
                        {opt.desc}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* ── 回收站路径 ───────────────────────────────────── */}
            <section>
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-5">
                  回收站路径
                </div>
                {isCustom && (
                  <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-600">
                    自定义
                  </span>
                )}
              </div>
              <div className="rounded-xl2 border border-line bg-surface-sub p-3">
                <div className="flex items-center gap-2">
                  <Trash2 size={14} className="shrink-0 text-ink-4" />
                  <div
                    className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-2"
                    title={effectivePath}
                  >
                    {effectivePath || '加载中...'}
                  </div>
                  <button
                    onClick={handlePick}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-ink-3 transition hover:border-brand hover:text-brand-600"
                    title="修改路径"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={handleOpen}
                    disabled={!effectivePath}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-ink-3 transition hover:border-line-strong hover:text-ink-1 disabled:opacity-50"
                    title="在文件管理器中打开"
                  >
                    <ExternalLink size={12} />
                  </button>
                  {isCustom && (
                    <button
                      onClick={handleReset}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-ink-3 transition hover:border-line-strong hover:text-ink-1"
                      title="恢复默认"
                    >
                      <RotateCcw size={12} />
                    </button>
                  )}
                </div>
                {errMsg && (
                  <div className="mt-2 rounded border border-danger-100 bg-danger-50 px-2.5 py-1.5 text-[11.5px] text-danger-600">
                    {errMsg}
                  </div>
                )}
                <div className="mt-2 text-[11px] leading-relaxed text-ink-4">
                  之后删除的会话写入这里 · 修改不会移动旧文件 · 不能选源目录
                </div>
              </div>
            </section>

            {/* ── 搜索索引 ─────────────────────────────────────── */}
            <section>
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-5">
                  搜索索引
                </div>
                {searchStatus?.building && (
                  <span className="inline-flex items-center gap-1 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-600">
                    <Loader2 size={10} className="animate-spin" />
                    构建中
                  </span>
                )}
              </div>
              <div className="rounded-xl2 border border-line bg-surface-sub p-3">
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
                    {rebuilding ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Database size={12} />
                    )}
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
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Preview({ tone }: { tone: 'light' | 'dark' | 'system' }): JSX.Element {
  if (tone === 'system') {
    return (
      <div className="relative h-16 overflow-hidden rounded-md ring-1 ring-line">
        <div className="absolute inset-0 grid grid-cols-2">
          <MiniSurface dark={false} />
          <MiniSurface dark={true} />
        </div>
      </div>
    );
  }
  return (
    <div className="h-16 overflow-hidden rounded-md ring-1 ring-line">
      <MiniSurface dark={tone === 'dark'} />
    </div>
  );
}

function MiniSurface({ dark }: { dark: boolean }): JSX.Element {
  const bg = dark ? '#0C0E13' : '#FAFAFB';
  const card = dark ? '#161922' : '#FFFFFF';
  const line = dark ? '#262B3A' : '#EEF0F4';
  const ink = dark ? '#E6E9F2' : '#0F172A';
  const dim = dark ? '#5E6677' : '#94A3B8';
  return (
    <div className="flex h-full w-full flex-col gap-1 p-1.5" style={{ background: bg }}>
      <div
        className="h-2.5 rounded"
        style={{ background: card, border: `1px solid ${line}` }}
      />
      <div
        className="flex flex-1 gap-1 rounded p-1"
        style={{ background: card, border: `1px solid ${line}` }}
      >
        <div className="flex w-3 flex-col gap-0.5">
          <div className="h-1 rounded" style={{ background: dim }} />
          <div className="h-1 rounded" style={{ background: dim, opacity: 0.5 }} />
          <div className="h-1 rounded" style={{ background: dim, opacity: 0.5 }} />
        </div>
        <div className="flex flex-1 flex-col gap-0.5">
          <div className="h-1 rounded" style={{ background: ink, width: '70%' }} />
          <div className="h-1 rounded" style={{ background: dim, width: '90%' }} />
          <div className="h-1 rounded" style={{ background: dim, width: '50%' }} />
        </div>
      </div>
    </div>
  );
}
