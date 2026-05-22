import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import { Maximize2, Minimize2, Eye, EyeOff, X } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../api';
import type { NormEvent, SessionSummary } from '../types';
import EventRenderer from './EventRenderer';

type Props = {
  session: SessionSummary | null;
  onClose: () => void;
};

export default function DetailDrawer({ session, onClose }: Props): JSX.Element {
  const [events, setEvents] = useState<NormEvent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMeta, setShowMeta] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!session) {
      setEvents(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    api
      .readSession(session.path)
      .then(setEvents)
      .catch((e: any) => setError(e?.message ?? String(e)))
      .finally(() => setLoading(false));
  }, [session]);

  const visibleEvents = events?.filter((e) => showMeta || e.kind !== 'meta') ?? [];
  const counts = events
    ? events.reduce<Record<string, number>>((acc, e) => {
        acc[e.kind] = (acc[e.kind] ?? 0) + 1;
        return acc;
      }, {})
    : {};

  return (
    <Dialog.Root open={!!session} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay fixed inset-0 z-30 bg-ink-1/30 backdrop-blur-[2px]" />
        <Dialog.Content
          className={clsx(
            'dialog-drawer fixed right-0 top-0 z-40 flex h-full flex-col border-l border-line bg-canvas shadow-pop outline-none',
            fullscreen ? 'left-0' : 'w-[62%] min-w-[680px]'
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-line bg-surface px-6 py-4">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-sm font-semibold text-ink-1">
                {session?.projectLabel}
              </Dialog.Title>
              <Dialog.Description className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-4">
                <span>{session && new Date(session.timestamp).toLocaleString('zh-CN')}</span>
                <span className="opacity-50">·</span>
                <span>{session?.messageCount} 条</span>
                <span className="opacity-50">·</span>
                <CountChip label="用户" value={counts.user ?? 0} tone="info" />
                <CountChip label="助手" value={counts.assistant ?? 0} tone="brand" />
                <CountChip label="工具" value={counts.tool_use ?? 0} tone="warn" />
                <CountChip label="思考" value={counts.thinking ?? 0} tone="think" />
              </Dialog.Description>
              <div className="mt-1 truncate font-mono text-[10px] text-ink-5">{session?.path}</div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <SmallButton
                title={showMeta ? '隐藏元数据' : '显示元数据'}
                onClick={() => setShowMeta((v) => !v)}
                active={showMeta}
                icon={showMeta ? <EyeOff size={14} /> : <Eye size={14} />}
                label={showMeta ? '元数据' : '元数据'}
              />
              <SmallButton
                title={fullscreen ? '退出全屏' : '全屏'}
                onClick={() => setFullscreen((v) => !v)}
                icon={fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              />
              <Dialog.Close asChild>
                <button
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface text-ink-3 transition hover:border-line-strong hover:text-ink-1"
                  title="关闭 (Esc)"
                >
                  <X size={15} />
                </button>
              </Dialog.Close>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {loading && <div className="py-10 text-center text-sm text-ink-5">加载中...</div>}
            {error && (
              <div className="rounded-xl border border-danger-100 bg-danger-50 p-4 text-sm text-danger-600">
                {error}
              </div>
            )}
            {!loading && !error && events && events.length === 0 && (
              <div className="py-10 text-center text-sm text-ink-5">空会话</div>
            )}
            {!loading &&
              !error &&
              visibleEvents.map((evt) => <EventRenderer key={evt.index} evt={evt} />)}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SmallButton({
  icon,
  label,
  title,
  active,
  onClick
}: {
  icon: React.ReactNode;
  label?: string;
  title: string;
  active?: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      title={title}
      className={clsx(
        'flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] transition',
        active
          ? 'border-brand-100 bg-brand-50 text-brand-700'
          : 'border-line bg-surface text-ink-3 hover:border-line-strong hover:text-ink-1'
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function CountChip({
  label,
  value,
  tone
}: {
  label: string;
  value: number;
  tone: 'info' | 'brand' | 'warn' | 'think';
}): JSX.Element | null {
  if (value === 0) return null;
  const tones: Record<string, string> = {
    info: 'bg-info-50 text-info-600',
    brand: 'bg-brand-50 text-brand-700',
    warn: 'bg-warn-50 text-warn-600',
    think: 'bg-think-50 text-ink-4'
  };
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium',
        tones[tone]
      )}
    >
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </span>
  );
}
