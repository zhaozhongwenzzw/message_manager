import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { CheckCircle2, Clock, Download, RefreshCw, Sparkles, X } from 'lucide-react';
import clsx from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../api';
import type { UpdaterStatus } from '../types';

type Props = { theme: 'claude' | 'codex' };

function formatBytes(b: number): string {
  if (!b || b < 1024) return `${b ?? 0} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function UpdateIndicator({ theme }: Props): JSX.Element {
  const [status, setStatus] = useState<UpdaterStatus>({ phase: 'idle' });
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  // Don't re-pop the dialog for a version the user already saw and dismissed.
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    api
      .updaterStatus()
      .then((s) => mounted && setStatus(s))
      .catch(() => {});
    const off = api.onUpdaterStatus((s) => mounted && setStatus(s));
    return () => {
      mounted = false;
      off();
    };
  }, []);

  // Auto-open on important transitions: a new available version (one the user
  // hasn't dismissed yet) and when a download finishes. Never auto-open on
  // checking/not-available/idle — those are background noise.
  useEffect(() => {
    if (status.phase === 'downloaded') {
      setOpen(true);
    } else if (status.phase === 'available' && status.info.version !== dismissedVersion) {
      setOpen(true);
    }
  }, [status, dismissedVersion]);

  async function handleCheck(): Promise<void> {
    setChecking(true);
    setOpen(true);
    try {
      await api.updaterCheck();
    } catch {
      // status will reflect error
    } finally {
      setChecking(false);
    }
  }

  async function handleDownload(): Promise<void> {
    // Fire-and-forget — autoUpdater.downloadUpdate() resolves only when the
    // download completes (which can take minutes). Awaiting here would keep
    // the button disabled the whole time, which is fine, but if the renderer
    // re-mounts mid-download we'd never reset `downloading`. Status events
    // drive the UI instead, so we just kick it off and trust the stream.
    setDownloading(true);
    api.updaterDownload().finally(() => setDownloading(false));
  }

  async function handleInstall(): Promise<void> {
    await api.updaterInstall();
  }

  function handleDismiss(): void {
    if (status.phase === 'available') setDismissedVersion(status.info.version);
    setOpen(false);
  }

  const indicator = buildIndicator(status, theme);

  return (
    <Dialog.Root open={open} onOpenChange={(o) => (o ? setOpen(true) : handleDismiss())}>
      <Dialog.Trigger asChild>
        <button
          title={indicator.title}
          onClick={() => setOpen(true)}
          className={clsx(
            'relative flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] transition',
            indicator.cls
          )}
        >
          {indicator.icon}
          {indicator.label && <span>{indicator.label}</span>}
          {indicator.dot && (
            <span className="absolute -right-0.5 -top-0.5 flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-500 opacity-70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-500" />
            </span>
          )}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay fixed inset-0 z-50 bg-ink-1/40 backdrop-blur-[2px]" />
        <Dialog.Content
          className="dialog-popup fixed left-1/2 top-1/2 z-50 w-[520px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-xl2 border border-line bg-surface p-5 shadow-pop outline-none"
        >
          <div className="flex items-start gap-3">
            <div
              className={clsx(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1',
                indicator.heroCls
              )}
            >
              {indicator.heroIcon}
            </div>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-[15px] font-semibold text-ink-1">
                {indicator.heroTitle}
              </Dialog.Title>
              <Dialog.Description asChild>
                <div className="mt-1.5 text-[12.5px] text-ink-3">{indicator.heroDesc}</div>
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

          {status.phase === 'downloading' && (
            <div className="mt-4 rounded-lg border border-line bg-surface-sub p-3">
              <div className="mb-1.5 flex items-baseline justify-between text-[11px] text-ink-4">
                <span>下载中…</span>
                <span className="tabular-nums">
                  {formatBytes(status.progress.transferred)} / {formatBytes(status.progress.total)}
                  {'  '}
                  ({formatBytes(status.progress.bytesPerSecond)}/s)
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-line">
                <div
                  className="h-full rounded-full bg-brand transition-all"
                  style={{ width: `${Math.min(100, Math.max(0, status.progress.percent ?? 0))}%` }}
                />
              </div>
            </div>
          )}

          {(status.phase === 'available' || status.phase === 'downloaded') &&
            status.info?.releaseNotes && (
              <div className="mt-4 max-h-64 overflow-y-auto rounded-lg border border-line bg-surface-sub p-3 text-[12.5px] text-ink-2">
                <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-ink-5">
                  更新日志
                </div>
                <div className="markdown leading-relaxed">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {status.info.releaseNotes}
                  </ReactMarkdown>
                </div>
              </div>
            )}

          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              onClick={handleCheck}
              disabled={checking || status.phase === 'checking' || status.phase === 'downloading'}
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink-3 transition hover:border-line-strong hover:text-ink-1 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {checking || status.phase === 'checking' ? '检查中…' : '检查更新'}
            </button>
            {status.phase === 'available' && (
              <>
                <button
                  onClick={handleDismiss}
                  className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink-3 transition hover:border-line-strong hover:text-ink-1"
                >
                  跳过此版本
                </button>
                <button
                  onClick={handleDownload}
                  disabled={downloading}
                  className="rounded-lg bg-brand px-4 py-1.5 text-[12.5px] font-semibold text-white transition hover:bg-brand-600 disabled:opacity-60"
                >
                  {downloading ? '正在开始…' : '下载更新'}
                </button>
              </>
            )}
            {status.phase === 'pending-publish' && status.info && (
              <button
                onClick={handleDownload}
                disabled={downloading}
                className="rounded-lg bg-brand px-4 py-1.5 text-[12.5px] font-semibold text-white transition hover:bg-brand-600 disabled:opacity-60"
              >
                {downloading ? '正在开始…' : '重试下载'}
              </button>
            )}
            {status.phase === 'downloaded' && (
              <button
                onClick={handleInstall}
                className="rounded-lg bg-brand px-4 py-1.5 text-[12.5px] font-semibold text-white transition hover:bg-brand-600"
              >
                立即重启并安装
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

type IndicatorView = {
  icon: React.ReactNode;
  label?: string;
  title: string;
  cls: string;
  dot?: boolean;
  heroIcon: React.ReactNode;
  heroTitle: string;
  heroDesc: React.ReactNode;
  heroCls: string;
};

function buildIndicator(status: UpdaterStatus, _theme: 'claude' | 'codex'): IndicatorView {
  switch (status.phase) {
    case 'checking':
      return {
        icon: <RefreshCw size={14} className="animate-spin" />,
        title: '正在检查更新…',
        cls: 'border-line bg-surface text-ink-3',
        heroIcon: <RefreshCw size={18} className="animate-spin" />,
        heroTitle: '正在检查更新…',
        heroDesc: '从 GitHub Releases 获取最新版本信息。',
        heroCls: 'bg-brand-50 text-brand-600 ring-brand-100'
      };
    case 'available':
      return {
        icon: <Sparkles size={14} className="text-brand-600" />,
        label: `v${status.info.version}`,
        title: `发现新版本 v${status.info.version}　点击查看`,
        cls: 'border-brand-200 bg-brand-50 text-brand-700',
        dot: true,
        heroIcon: <Sparkles size={18} />,
        heroTitle: `发现新版本 v${status.info.version}`,
        heroDesc: '需要你确认才会开始下载。可以点击「下载更新」开始下载，或「跳过此版本」暂不更新。',
        heroCls: 'bg-brand-50 text-brand-600 ring-brand-100'
      };
    case 'downloading':
      return {
        icon: <Download size={14} className="text-brand-600" />,
        label: `${Math.round(status.progress.percent ?? 0)}%`,
        title: `正在下载 v${status.info.version}…`,
        cls: 'border-brand-200 bg-brand-50 text-brand-700',
        heroIcon: <Download size={18} />,
        heroTitle: `下载 v${status.info.version}`,
        heroDesc: '请稍候，下载完成后会提示你重启安装。',
        heroCls: 'bg-brand-50 text-brand-600 ring-brand-100'
      };
    case 'downloaded':
      return {
        icon: <CheckCircle2 size={14} className="text-brand-600" />,
        label: '可安装',
        title: `v${status.info.version} 已就绪，可以重启安装`,
        cls: 'border-brand-200 bg-brand-50 text-brand-700',
        dot: true,
        heroIcon: <CheckCircle2 size={18} />,
        heroTitle: `v${status.info.version} 已就绪`,
        heroDesc: '点击下方按钮立即重启并安装；也可以下次启动时自动安装。',
        heroCls: 'bg-brand-50 text-brand-600 ring-brand-100'
      };
    case 'pending-publish':
      return {
        icon: <Clock size={14} className="text-warn-600" />,
        label: '待发布',
        title: status.message,
        cls: 'border-warn-100 bg-warn-50 text-warn-600',
        dot: true,
        heroIcon: <Clock size={18} />,
        heroTitle: status.info ? `v${status.info.version} 还未就绪` : '新版本还未就绪',
        heroDesc: status.message,
        heroCls: 'bg-warn-50 text-warn-600 ring-warn-100'
      };
    case 'error':
      return {
        icon: <Download size={14} className="text-danger-500" />,
        title: '检查更新失败：' + status.message,
        cls: 'border-danger-100 bg-danger-50 text-danger-600',
        heroIcon: <Download size={18} />,
        heroTitle: '检查更新失败',
        heroDesc: status.message,
        heroCls: 'bg-danger-50 text-danger-500 ring-danger-100'
      };
    case 'not-available':
      return {
        icon: <CheckCircle2 size={14} />,
        title: '已是最新版本',
        cls: 'border-line bg-surface text-ink-3 hover:border-line-strong hover:text-ink-1',
        heroIcon: <CheckCircle2 size={18} />,
        heroTitle: '已是最新版本',
        heroDesc: status.info?.version ? `当前版本 v${status.info.version}` : '当前已经是最新版本。',
        heroCls: 'bg-brand-50 text-brand-600 ring-brand-100'
      };
    case 'idle':
    default:
      return {
        icon: <Download size={14} />,
        title: '检查更新',
        cls: 'border-line bg-surface text-ink-3 hover:border-line-strong hover:text-ink-1',
        heroIcon: <Download size={18} />,
        heroTitle: '检查更新',
        heroDesc: '点击下方按钮立刻向 GitHub Releases 检查新版本。',
        heroCls: 'bg-surface-sub text-ink-3 ring-line'
      };
  }
}
