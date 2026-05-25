import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Copy,
  Download,
  Loader2,
  RefreshCw,
  Settings as SettingsIcon,
  Sparkles,
  X
} from 'lucide-react';
import clsx from 'clsx';
import { api } from '../api';
import type { LlmStreamEvent, SessionSummary } from '../types';

type Props = {
  open: boolean;
  session: SessionSummary | null;
  onOpenChange: (open: boolean) => void;
  onOpenSettings: () => void;
};

type PhaseKey = 'reading' | 'preparing' | 'generating';
type PhaseStatus = 'pending' | 'running' | 'done' | 'error';

type PhaseState = {
  key: PhaseKey;
  status: PhaseStatus;
  startedAt?: number;
  finishedAt?: number;
  meta?: Record<string, unknown>;
};

const PHASE_ORDER: PhaseKey[] = ['reading', 'preparing', 'generating'];
const PHASE_LABEL: Record<PhaseKey, string> = {
  reading: '读取会话',
  preparing: '整理上下文',
  generating: '生成简报'
};

function initialPhases(): PhaseState[] {
  return PHASE_ORDER.map((key) => ({ key, status: 'pending' as const }));
}

export default function SummarizeDialog({
  open,
  session,
  onOpenChange,
  onOpenSettings
}: Props): JSX.Element {
  const [needsSetup, setNeedsSetup] = useState(false);
  const [phases, setPhases] = useState<PhaseState[]>(initialPhases);
  const [output, setOutput] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamId, setStreamId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);

  const outputRef = useRef<HTMLDivElement>(null);
  const streamIdRef = useRef<string | null>(null);

  useEffect(() => {
    streamIdRef.current = streamId;
  }, [streamId]);

  // Auto-scroll output to bottom on token arrival
  useEffect(() => {
    if (!outputRef.current) return;
    outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [output]);

  // Subscribe to stream events while dialog is open
  useEffect(() => {
    if (!open) return;
    const off = api.onLlmStream((ev: LlmStreamEvent) => {
      if (!streamIdRef.current || ev.streamId !== streamIdRef.current) return;
      if (ev.type === 'phase') {
        setPhases((prev) =>
          prev.map((p) => {
            if (p.key !== ev.phase) return p;
            if (ev.status === 'running') {
              return { ...p, status: 'running', startedAt: Date.now(), meta: ev.meta };
            }
            return {
              ...p,
              status: ev.status,
              finishedAt: Date.now(),
              meta: { ...(p.meta ?? {}), ...(ev.meta ?? {}) }
            };
          })
        );
      } else if (ev.type === 'token') {
        setOutput((prev) => prev + ev.delta);
      } else if (ev.type === 'done') {
        setOutput(ev.fullText);
        setDone(true);
      } else if (ev.type === 'error') {
        setError(ev.message);
        setDone(true);
        setPhases((prev) =>
          prev.map((p) => (p.status === 'running' ? { ...p, status: 'error' } : p))
        );
      }
    });
    return () => {
      off?.();
    };
  }, [open]);

  // Start when opened with a session
  useEffect(() => {
    if (!open || !session) return;
    let cancelled = false;
    setPhases(initialPhases());
    setOutput('');
    setDone(false);
    setError(null);
    setStreamId(null);
    setCopied(false);
    setSavedPath(null);

    (async () => {
      try {
        const cfg = await api.llmConfigGet();
        if (!cfg.enabled || !cfg.hasApiKey) {
          if (!cancelled) setNeedsSetup(true);
          return;
        }
        if (cancelled) return;
        setNeedsSetup(false);
        const r = await api.llmSummarizeStart({ sessionPath: session.path });
        if (cancelled) {
          void api.llmSummarizeCancel({ streamId: r.streamId }).catch(() => {});
          return;
        }
        setStreamId(r.streamId);
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message ?? String(e));
          setDone(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, session]);

  // Cancel on close
  useEffect(() => {
    if (open) return;
    if (streamIdRef.current) {
      void api.llmSummarizeCancel({ streamId: streamIdRef.current }).catch(() => {});
    }
  }, [open]);

  async function handleRegenerate(): Promise<void> {
    if (!session) return;
    if (streamIdRef.current) {
      await api.llmSummarizeCancel({ streamId: streamIdRef.current }).catch(() => {});
    }
    setPhases(initialPhases());
    setOutput('');
    setDone(false);
    setError(null);
    setCopied(false);
    setSavedPath(null);
    try {
      const r = await api.llmSummarizeStart({ sessionPath: session.path });
      setStreamId(r.streamId);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setDone(true);
    }
  }

  async function handleCancel(): Promise<void> {
    if (!streamIdRef.current) return;
    await api.llmSummarizeCancel({ streamId: streamIdRef.current }).catch(() => {});
    onOpenChange(false);
  }

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  async function handleSave(): Promise<void> {
    if (!session || !output) return;
    setSaving(true);
    try {
      const defaultName = `${session.projectLabel || 'session'}-续聊简报.md`.replace(
        /[\\/:*?"<>|]/g,
        '_'
      );
      const res = await api.saveFile({
        title: '保存续聊简报',
        defaultPath: defaultName,
        content: output
      });
      if (res?.path) setSavedPath(res.path);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }

  const running = !done && !error;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay fixed inset-0 z-50 bg-ink-1/40 backdrop-blur-[2px]" />
        <Dialog.Content className="dialog-popup fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[720px] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl2 border border-line bg-surface shadow-pop outline-none">
          <div className="flex items-start gap-3 border-b border-line px-5 py-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 ring-1 ring-brand-100">
              <Sparkles size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="truncate text-[15px] font-semibold text-ink-1">
                续聊简报 · {session?.projectLabel ?? ''}
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-[12px] text-ink-4">
                把会话压缩成简报，可粘到其他 LLM 接着干
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                className="flex h-8 w-8 items-center justify-center rounded-md text-ink-5 hover:bg-surface-sub hover:text-ink-1"
                title="关闭"
              >
                <X size={14} />
              </button>
            </Dialog.Close>
          </div>

          {needsSetup ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
              <AlertCircle size={32} className="text-warn-500" />
              <div className="text-[14px] font-medium text-ink-1">尚未配置 AI 助手</div>
              <div className="max-w-sm text-[12.5px] text-ink-4">
                请先到设置里启用「AI 助手」并填写 Base URL 和 API Key。
              </div>
              <button
                onClick={() => {
                  onOpenChange(false);
                  onOpenSettings();
                }}
                className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-brand bg-brand-50 px-3 py-1.5 text-[12.5px] font-medium text-brand-700 transition hover:bg-brand-100"
              >
                <SettingsIcon size={13} />
                打开设置
              </button>
            </div>
          ) : (
            <>
              {/* Phases timeline */}
              <div className="border-b border-line px-5 py-3">
                <ol className="space-y-2">
                  {phases.map((p, idx) => (
                    <PhaseRow key={p.key} step={idx + 1} phase={p} />
                  ))}
                </ol>
              </div>

              {/* Streaming output */}
              <div
                ref={outputRef}
                className="min-h-[200px] flex-1 overflow-y-auto bg-surface-sub px-5 py-4"
              >
                {error ? (
                  <div className="rounded-lg border border-danger-100 bg-danger-50 p-3 text-[12.5px] text-danger-600">
                    <div className="font-medium">生成失败</div>
                    <div className="mt-1 font-mono text-[11.5px]">{error}</div>
                  </div>
                ) : output ? (
                  <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-ink-1">
                    {output}
                    {!done && <span className="ml-0.5 inline-block h-3.5 w-1.5 -translate-y-px animate-pulse bg-brand-500 align-middle" />}
                  </pre>
                ) : (
                  <div className="flex h-full items-center justify-center text-[12px] text-ink-5">
                    {running ? '等待 LLM 响应...' : '尚未开始'}
                  </div>
                )}
              </div>

              {/* Footer actions */}
              <div className="flex items-center gap-2 border-t border-line bg-surface px-5 py-3">
                {savedPath && (
                  <div className="flex-1 truncate text-[11.5px] text-ink-4" title={savedPath}>
                    ✓ 已保存到 {savedPath}
                  </div>
                )}
                {!savedPath && <div className="flex-1" />}
                {running ? (
                  <button
                    onClick={() => void handleCancel()}
                    className="flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-[12.5px] text-ink-3 transition hover:border-line-strong"
                  >
                    取消
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => void handleRegenerate()}
                      className="flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-[12.5px] text-ink-3 transition hover:border-brand hover:text-brand-600"
                    >
                      <RefreshCw size={13} />
                      重新生成
                    </button>
                    <button
                      onClick={() => void handleSave()}
                      disabled={!output || saving}
                      className="flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-[12.5px] text-ink-3 transition hover:border-brand hover:text-brand-600 disabled:opacity-50"
                    >
                      {saving ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                      保存为 .md
                    </button>
                    <button
                      onClick={() => void handleCopy()}
                      disabled={!output}
                      className="flex h-8 items-center gap-1.5 rounded-md border border-brand bg-brand-50 px-3 text-[12.5px] font-medium text-brand-700 transition hover:bg-brand-100 disabled:opacity-50"
                    >
                      {copied ? <Check size={13} /> : <Copy size={13} />}
                      {copied ? '已复制' : '复制'}
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PhaseRow({ step, phase }: { step: number; phase: PhaseState }): JSX.Element {
  const duration =
    phase.finishedAt && phase.startedAt ? phase.finishedAt - phase.startedAt : null;
  return (
    <li className="flex items-start gap-3">
      <div
        className={clsx(
          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
          phase.status === 'done' && 'bg-brand text-white',
          phase.status === 'running' && 'bg-brand-50 text-brand-700 ring-1 ring-brand-200',
          phase.status === 'error' && 'bg-danger-50 text-danger-600 ring-1 ring-danger-100',
          phase.status === 'pending' && 'bg-surface-sub text-ink-5 ring-1 ring-line'
        )}
      >
        {phase.status === 'done' ? (
          <Check size={11} strokeWidth={3} />
        ) : phase.status === 'running' ? (
          <Loader2 size={11} className="animate-spin" />
        ) : phase.status === 'error' ? (
          <X size={11} strokeWidth={3} />
        ) : (
          step
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className={clsx(
              'text-[12.5px] font-medium',
              phase.status === 'done' || phase.status === 'running' ? 'text-ink-1' : 'text-ink-4'
            )}
          >
            {PHASE_LABEL[phase.key]}
          </span>
          {duration != null && (
            <span className="text-[11px] tabular-nums text-ink-5">
              {duration < 1000 ? `${duration} ms` : `${(duration / 1000).toFixed(1)} s`}
            </span>
          )}
        </div>
        {phase.meta && (phase.status === 'done' || phase.status === 'running') && (
          <PhaseMeta phase={phase.key} meta={phase.meta} />
        )}
      </div>
    </li>
  );
}

function PhaseMeta({
  phase,
  meta
}: {
  phase: PhaseKey;
  meta: Record<string, unknown>;
}): JSX.Element | null {
  if (phase === 'reading' && meta.eventCount != null) {
    return (
      <div className="mt-0.5 text-[11px] text-ink-4">
        共 {String(meta.eventCount)} 条事件
      </div>
    );
  }
  if (phase === 'preparing' && meta.estTokens != null) {
    return (
      <div className="mt-0.5 text-[11px] text-ink-4">
        prompt 约 {Number(meta.estTokens).toLocaleString()} token
        {meta.truncated ? ' · 已截断早期内容' : ''}
      </div>
    );
  }
  if (phase === 'generating' && meta.model) {
    return (
      <div className="mt-0.5 text-[11px] text-ink-4">
        模型: {String(meta.model)}
      </div>
    );
  }
  return null;
}
