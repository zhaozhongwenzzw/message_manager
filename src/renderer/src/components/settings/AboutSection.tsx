import { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  Folder,
  Info,
  Loader2,
  RefreshCw,
  Sparkles
} from 'lucide-react';
import clsx from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../../api';
import type { UpdaterStatus } from '../../types';

type Props = { open: boolean };

function formatBytes(b: number): string {
  if (!b || b < 1024) return `${b ?? 0} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function AboutSection({ open }: Props): JSX.Element {
  const [version, setVersion] = useState<string>('—');
  const [status, setStatus] = useState<UpdaterStatus>({ phase: 'idle' });
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let mounted = true;
    void api.appVersion().then((v) => mounted && setVersion(v));
    void api
      .updaterStatus()
      .then((s) => mounted && setStatus(s))
      .catch(() => {});
    const off = api.onUpdaterStatus((s) => mounted && setStatus(s));
    return () => {
      mounted = false;
      off();
    };
  }, [open]);

  async function handleCheck(): Promise<void> {
    setChecking(true);
    try {
      await api.updaterCheck();
    } catch {
      // status will reflect error
    } finally {
      setChecking(false);
    }
  }

  function handleDownload(): void {
    setDownloading(true);
    api.updaterDownload().finally(() => setDownloading(false));
  }

  async function handleInstall(): Promise<void> {
    await api.updaterInstall();
  }

  const summary = describeStatus(status, version);

  return (
    <div className="space-y-3">
      {/* App info */}
      <div className="rounded-xl2 border border-line bg-surface-sub p-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 ring-1 ring-brand-100">
            <Info size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-ink-1">Recall</div>
            <div className="text-[11.5px] text-ink-4">
              本地管理 Claude Code / Codex 历史对话
            </div>
          </div>
          <div className="rounded-md border border-line bg-surface px-2 py-0.5 font-mono text-[12px] tabular-nums text-ink-2">
            v{version}
          </div>
        </div>
      </div>

      {/* Update status + actions */}
      <div className="rounded-xl2 border border-line bg-surface-sub p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[12px] font-medium text-ink-2">检查更新</div>
          {summary.tag && (
            <span
              className={clsx(
                'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium',
                summary.tagCls
              )}
            >
              {summary.tagIcon}
              {summary.tag}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1 text-[12px] text-ink-3">{summary.text}</div>
          <div className="flex shrink-0 items-center gap-2">
            {status.phase === 'available' && (
              <button
                onClick={handleDownload}
                disabled={downloading}
                className="flex h-8 items-center gap-1 rounded-md border border-brand bg-brand-50 px-3 text-[12px] font-medium text-brand-700 transition hover:bg-brand-100 disabled:opacity-60"
              >
                {downloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                {downloading ? '开始中…' : `下载 v${status.info.version}`}
              </button>
            )}
            {status.phase === 'pending-publish' && status.info && (
              <button
                onClick={handleDownload}
                disabled={downloading}
                className="flex h-8 items-center gap-1 rounded-md border border-warn-100 bg-warn-50 px-3 text-[12px] font-medium text-warn-600 transition hover:bg-warn-100 disabled:opacity-60"
              >
                {downloading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                重试下载
              </button>
            )}
            {status.phase === 'downloaded' && (
              <button
                onClick={() => void handleInstall()}
                className="flex h-8 items-center gap-1 rounded-md border border-brand bg-brand px-3 text-[12px] font-medium text-white transition hover:bg-brand-600"
              >
                <CheckCircle2 size={12} />
                重启安装
              </button>
            )}
            <button
              onClick={() => void handleCheck()}
              disabled={
                checking ||
                status.phase === 'checking' ||
                status.phase === 'downloading'
              }
              className="flex h-8 items-center gap-1 rounded-md border border-line bg-surface px-3 text-[12px] text-ink-3 transition hover:border-brand hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {checking || status.phase === 'checking' ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} />
              )}
              {checking || status.phase === 'checking' ? '检查中…' : '检查更新'}
            </button>
          </div>
        </div>

        {/* Download progress */}
        {status.phase === 'downloading' && (
          <div className="mt-3 rounded-md border border-line bg-surface p-2.5">
            <div className="mb-1.5 flex items-baseline justify-between text-[11px] text-ink-4">
              <span>正在下载 v{status.info.version}…</span>
              <span className="tabular-nums">
                {formatBytes(status.progress.transferred)} / {formatBytes(status.progress.total)}
                <span className="ml-1.5">({formatBytes(status.progress.bytesPerSecond)}/s)</span>
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full bg-brand transition-all"
                style={{ width: `${Math.min(100, Math.max(0, status.progress.percent ?? 0))}%` }}
              />
            </div>
          </div>
        )}

        {/* Error detail */}
        {status.phase === 'error' && (
          <div className="mt-2 rounded-md border border-danger-100 bg-danger-50 px-2.5 py-1.5 font-mono text-[11px] text-danger-600">
            {status.message}
          </div>
        )}

        {/* Release notes */}
        {(status.phase === 'available' || status.phase === 'downloaded') && status.info?.releaseNotes && (
          <div className="mt-3 max-h-48 overflow-y-auto rounded-md border border-line bg-surface p-2.5 text-[12px] text-ink-2">
            <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-ink-5">
              更新日志 · v{status.info.version}
            </div>
            <div className="markdown leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{status.info.releaseNotes}</ReactMarkdown>
            </div>
          </div>
        )}
      </div>

      {/* Links */}
      <div className="rounded-xl2 border border-line bg-surface-sub p-3">
        <div className="mb-2 text-[12px] font-medium text-ink-2">相关链接</div>
        <div className="grid gap-1.5">
          <LinkRow
            icon={<ExternalLink size={12} />}
            label="GitHub 仓库"
            href="https://github.com/zhaozhongwenzzw/message_manager"
          />
          <LinkRow
            icon={<ExternalLink size={12} />}
            label="历史发布"
            href="https://github.com/zhaozhongwenzzw/message_manager/releases"
          />
          <ActionRow
            icon={<Folder size={12} />}
            label="打开 app 数据目录（~/.claude-manager）"
            onClick={() => void api.openAppData()}
          />
        </div>
      </div>
    </div>
  );
}

type Summary = {
  text: string;
  tag?: string;
  tagCls?: string;
  tagIcon?: JSX.Element;
};

function describeStatus(s: UpdaterStatus, current: string): Summary {
  switch (s.phase) {
    case 'available':
      return {
        text: `发现新版本 v${s.info.version}，可立即下载。`,
        tag: '可更新',
        tagCls: 'bg-brand-50 text-brand-700',
        tagIcon: <Sparkles size={10} />
      };
    case 'downloading':
      return {
        text: `正在后台下载 v${s.info.version}（${Math.round(s.progress.percent ?? 0)}%）。`,
        tag: '下载中',
        tagCls: 'bg-brand-50 text-brand-700',
        tagIcon: <Download size={10} />
      };
    case 'downloaded':
      return {
        text: `v${s.info.version} 已下载完毕，重启后自动安装。`,
        tag: '可安装',
        tagCls: 'bg-brand-50 text-brand-700',
        tagIcon: <CheckCircle2 size={10} />
      };
    case 'pending-publish':
      return {
        text: s.message,
        tag: '待发布',
        tagCls: 'bg-warn-50 text-warn-600',
        tagIcon: <Clock size={10} />
      };
    case 'error':
      return {
        text: '上次检查时出错，详情见下方。',
        tag: '错误',
        tagCls: 'bg-danger-50 text-danger-600',
        tagIcon: <AlertCircle size={10} />
      };
    case 'not-available':
      return {
        text: `当前 v${current} 已是最新版本。`,
        tag: '已是最新',
        tagCls: 'bg-ink-1/5 text-ink-3',
        tagIcon: <CheckCircle2 size={10} />
      };
    case 'checking':
      return { text: '正在从 GitHub Releases 检查最新版本…' };
    case 'idle':
    default:
      return { text: '尚未检查更新，点击右侧按钮立即查询 GitHub Releases。' };
  }
}

function LinkRow({ icon, label, href }: { icon: JSX.Element; label: string; href: string }): JSX.Element {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-ink-3 transition hover:bg-surface hover:text-ink-1"
    >
      <span className="text-ink-5">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
    </a>
  );
}

function ActionRow({
  icon,
  label,
  onClick
}: {
  icon: JSX.Element;
  label: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-ink-3 transition hover:bg-surface hover:text-ink-1"
    >
      <span className="text-ink-5">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
    </button>
  );
}
