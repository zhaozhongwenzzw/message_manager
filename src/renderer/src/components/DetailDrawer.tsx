import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, Eye, EyeOff, X } from 'lucide-react';
import clsx from 'clsx';
import { useVirtualizer } from '@tanstack/react-virtual';
import { api } from '../api';
import type { NormEvent, SessionSummary } from '../types';
import EventRenderer from './EventRenderer';

type Props = {
  session: SessionSummary | null;
  onClose: () => void;
  jumpToEvent?: number;
  highlightQuery?: string;
};

// Threshold below which we skip virtualization — for tiny sessions the
// overhead and absolute-positioning quirks aren't worth it.
const VIRTUAL_THRESHOLD = 30;

export default function DetailDrawer({ session, onClose, jumpToEvent, highlightQuery }: Props): JSX.Element {
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
      .catch((e: any) => {
        const msg = e?.message ?? String(e);
        if (/ENOENT|no such file/i.test(msg)) {
          setError('该会话文件已被删除或移动。搜索索引可能滞后，请回到主视图点刷新。');
        } else {
          setError(msg);
        }
      })
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
          <EventScroll
            loading={loading}
            error={error}
            events={events}
            visibleEvents={visibleEvents}
            // Width change (fullscreen toggle) reflows markdown → height changes.
            // Keying the scroll container on `fullscreen` discards old measurements
            // cleanly so the virtualizer doesn't render stale positions.
            widthKey={fullscreen ? 'full' : 'half'}
            jumpToEvent={jumpToEvent}
            highlightQuery={highlightQuery}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function EventScroll({
  loading,
  error,
  events,
  visibleEvents,
  widthKey,
  jumpToEvent,
  highlightQuery
}: {
  loading: boolean;
  error: string | null;
  events: NormEvent[] | null;
  visibleEvents: NormEvent[];
  widthKey: string;
  jumpToEvent?: number;
  highlightQuery?: string;
}): JSX.Element {
  if (loading) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="py-10 text-center text-sm text-ink-5">加载中...</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="rounded-xl border border-danger-100 bg-danger-50 p-4 text-sm text-danger-600">
          {error}
        </div>
      </div>
    );
  }
  if (events && events.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="py-10 text-center text-sm text-ink-5">空会话</div>
      </div>
    );
  }
  if (visibleEvents.length < VIRTUAL_THRESHOLD) {
    return (
      <NonVirtualScroll
        visibleEvents={visibleEvents}
        jumpToEvent={jumpToEvent}
        highlightQuery={highlightQuery}
      />
    );
  }
  return (
    <VirtualEventList
      key={widthKey}
      visibleEvents={visibleEvents}
      total={events?.length ?? 0}
      jumpToEvent={jumpToEvent}
      highlightQuery={highlightQuery}
    />
  );
}

function NonVirtualScroll({
  visibleEvents,
  jumpToEvent,
  highlightQuery
}: {
  visibleEvents: NormEvent[];
  jumpToEvent?: number;
  highlightQuery?: string;
}): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLDivElement>(null);
  const [hitTick, setHitTick] = useState(0);

  useEffect(() => {
    if (jumpToEvent == null) return;
    // run after layout
    const t = window.setTimeout(() => {
      targetRef.current?.scrollIntoView({ block: 'center', behavior: 'auto' });
      setHitTick((n) => n + 1);
    }, 50);
    return () => window.clearTimeout(t);
  }, [jumpToEvent, visibleEvents]);

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
      {visibleEvents.map((evt) => {
        const isHit = evt.index === jumpToEvent;
        return (
          <div
            key={isHit ? `hit-${hitTick}` : evt.index}
            ref={isHit ? targetRef : undefined}
            className={isHit ? 'search-hit-target' : undefined}
          >
            <EventRenderer evt={evt} highlightQuery={highlightQuery} />
          </div>
        );
      })}
    </div>
  );
}

function VirtualEventList({
  visibleEvents,
  jumpToEvent,
  highlightQuery
}: {
  visibleEvents: NormEvent[];
  total: number;
  jumpToEvent?: number;
  highlightQuery?: string;
}): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hitTick, setHitTick] = useState(0);

  const virtualizer = useVirtualizer({
    count: visibleEvents.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 140,
    overscan: 6,
    // Use the event's own index as the stable key — survives meta filter
    // toggling so already-measured rows don't lose their size.
    getItemKey: (i) => visibleEvents[i].index
  });

  useEffect(() => {
    if (jumpToEvent == null) return;
    const targetVisibleIdx = visibleEvents.findIndex((e) => e.index === jumpToEvent);
    if (targetVisibleIdx < 0) return;
    const t = window.setTimeout(() => {
      virtualizer.scrollToIndex(targetVisibleIdx, { align: 'center' });
      setHitTick((n) => n + 1);
    }, 50);
    return () => window.clearTimeout(t);
  }, [jumpToEvent, visibleEvents, virtualizer]);

  const items = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
      <div
        style={{
          height: `${totalSize}px`,
          width: '100%',
          position: 'relative'
        }}
      >
        {items.map((vi) => {
          const evt = visibleEvents[vi.index];
          const isHit = evt.index === jumpToEvent;
          return (
            <div
              key={isHit ? `hit-${hitTick}` : vi.key}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vi.start}px)`
              }}
              className={isHit ? 'search-hit-target' : undefined}
            >
              <EventRenderer evt={evt} highlightQuery={highlightQuery} />
            </div>
          );
        })}
      </div>
    </div>
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
