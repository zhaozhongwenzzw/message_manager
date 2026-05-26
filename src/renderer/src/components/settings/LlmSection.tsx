import { useEffect, useState } from 'react';
import {
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Pencil,
  Sparkles,
  Zap
} from 'lucide-react';
import clsx from 'clsx';
import { api } from '../../api';
import type { LlmConfig } from '../../types';

type TestResult =
  | { ok: true; modelInfo?: string }
  | { ok: false; error: string }
  | null;

type Props = { open: boolean };

const CONTEXT_PRESETS = [8_000, 32_000, 128_000, 200_000, 1_000_000] as const;

export default function LlmSection({ open }: Props): JSX.Element {
  const [llm, setLlm] = useState<LlmConfig | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [keyEditing, setKeyEditing] = useState(false);
  const [keyVisible, setKeyVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult>(null);

  useEffect(() => {
    if (!open) return;
    setTestResult(null);
    setKeyEditing(false);
    setKeyInput('');
    void api
      .llmConfigGet()
      .then(setLlm)
      .catch(() => setLlm(null));
  }, [open]);

  async function patch(p: Partial<LlmConfig> & { apiKey?: string }): Promise<void> {
    setSaving(true);
    try {
      const next = await api.llmConfigSet(p);
      setLlm(next);
      if (p.apiKey !== undefined) {
        setKeyEditing(false);
        setKeyInput('');
      }
    } catch (e: any) {
      setTestResult({ ok: false, error: e?.message ?? String(e) });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest(): Promise<void> {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.llmTestConnection();
      setTestResult(res);
    } catch (e: any) {
      setTestResult({ ok: false, error: e?.message ?? String(e) });
    } finally {
      setTesting(false);
    }
  }

  if (!llm) {
    return (
      <div className="rounded-xl2 border border-line bg-surface-sub p-3 text-[12px] text-ink-5">
        加载中...
      </div>
    );
  }

  return (
    <div className="rounded-xl2 border border-line bg-surface-sub p-3">
      <div className="space-y-2.5">
        <label className="flex cursor-pointer items-center gap-2 text-[12px] text-ink-2">
          <input
            type="checkbox"
            checked={llm.enabled}
            onChange={(e) => void patch({ enabled: e.target.checked })}
            className="h-4 w-4 cursor-pointer accent-brand-600"
          />
          <Sparkles size={13} className="text-brand-600" />
          启用「续聊简报」功能（用 LLM 压缩会话上下文）
        </label>

        {llm.enabled && (
          <>
            <div>
              <div className="mb-1 text-[11px] text-ink-5">Base URL</div>
              <input
                type="text"
                value={llm.baseUrl}
                onChange={(e) => setLlm({ ...llm, baseUrl: e.target.value })}
                onBlur={() => void patch({ baseUrl: llm.baseUrl })}
                placeholder="https://api.openai.com/v1"
                className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 font-mono text-[12px] text-ink-1 outline-none transition focus:border-brand"
              />
            </div>

            <div>
              <div className="mb-1 text-[11px] text-ink-5">Model</div>
              <input
                type="text"
                value={llm.model}
                onChange={(e) => setLlm({ ...llm, model: e.target.value })}
                onBlur={() => void patch({ model: llm.model })}
                placeholder="gpt-4o-mini"
                className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 font-mono text-[12px] text-ink-1 outline-none transition focus:border-brand"
              />
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between text-[11px] text-ink-5">
                <span>上下文窗口（token）</span>
                <span className="text-[10px]">超过会自动分段串行精炼</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={4000}
                  step={1000}
                  value={llm.contextWindow}
                  onChange={(e) =>
                    setLlm({
                      ...llm,
                      contextWindow: Math.max(4000, Number(e.target.value) || 0)
                    })
                  }
                  onBlur={() => void patch({ contextWindow: llm.contextWindow })}
                  className="w-32 rounded-md border border-line bg-surface px-2.5 py-1.5 font-mono text-[12px] tabular-nums text-ink-1 outline-none transition focus:border-brand"
                />
                <div className="flex flex-wrap gap-1">
                  {CONTEXT_PRESETS.map((n) => (
                    <button
                      key={n}
                      onClick={() =>
                        void patch({ contextWindow: n }).then(() =>
                          setLlm((cur) => (cur ? { ...cur, contextWindow: n } : cur))
                        )
                      }
                      className={clsx(
                        'rounded border px-1.5 py-0.5 text-[10.5px] transition',
                        llm.contextWindow === n
                          ? 'border-brand bg-brand-50 text-brand-700'
                          : 'border-line bg-surface text-ink-4 hover:border-line-strong hover:text-ink-2'
                      )}
                    >
                      {n >= 1_000_000 ? `${n / 1_000_000}M` : `${n / 1000}k`}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <div className="mb-1 text-[11px] text-ink-5">API Key</div>
              {llm.hasApiKey && !keyEditing ? (
                <div className="flex items-center gap-2">
                  <div className="flex flex-1 items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5 font-mono text-[12px] text-ink-3">
                    <KeyRound size={12} className="text-ink-5" />
                    ••••••••••••••••
                    <span className="ml-auto text-[10px] text-ink-5">已加密</span>
                  </div>
                  <button
                    onClick={() => {
                      setKeyEditing(true);
                      setKeyInput('');
                    }}
                    className="flex h-8 items-center gap-1 rounded-md border border-line bg-surface px-2.5 text-[12px] text-ink-3 transition hover:border-brand hover:text-brand-600"
                  >
                    <Pencil size={12} />
                    修改
                  </button>
                  <button
                    onClick={() => void patch({ apiKey: '' })}
                    className="flex h-8 items-center gap-1 rounded-md border border-line bg-surface px-2.5 text-[12px] text-ink-3 transition hover:border-danger-200 hover:text-danger-600"
                  >
                    清除
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <input
                      type={keyVisible ? 'text' : 'password'}
                      value={keyInput}
                      onChange={(e) => setKeyInput(e.target.value)}
                      placeholder="sk-..."
                      className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 pr-8 font-mono text-[12px] text-ink-1 outline-none transition focus:border-brand"
                    />
                    <button
                      onClick={() => setKeyVisible((v) => !v)}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-ink-5 hover:text-ink-2"
                      title={keyVisible ? '隐藏' : '显示'}
                    >
                      {keyVisible ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                  </div>
                  <button
                    onClick={() => void patch({ apiKey: keyInput })}
                    disabled={!keyInput.trim() || saving}
                    className="flex h-8 items-center gap-1 rounded-md border border-brand bg-brand-50 px-2.5 text-[12px] text-brand-700 transition hover:bg-brand-100 disabled:opacity-50"
                  >
                    {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                    保存
                  </button>
                  {llm.hasApiKey && (
                    <button
                      onClick={() => {
                        setKeyEditing(false);
                        setKeyInput('');
                      }}
                      className="flex h-8 items-center rounded-md border border-line bg-surface px-2.5 text-[12px] text-ink-3 transition hover:border-line-strong"
                    >
                      取消
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => void handleTest()}
                disabled={testing || !llm.hasApiKey}
                className="flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-[12px] text-ink-3 transition hover:border-brand hover:text-brand-600 disabled:opacity-50"
              >
                {testing ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                测试连接
              </button>
              {testResult && (
                <div
                  className={clsx(
                    'flex-1 truncate rounded px-2 py-1 text-[11.5px]',
                    testResult.ok
                      ? 'bg-brand-50 text-brand-700'
                      : 'bg-danger-50 text-danger-600'
                  )}
                  title={
                    testResult.ok
                      ? `连接成功${testResult.modelInfo ? ` · ${testResult.modelInfo}` : ''}`
                      : testResult.error
                  }
                >
                  {testResult.ok
                    ? `✓ 连接成功${testResult.modelInfo ? ` · ${testResult.modelInfo}` : ''}`
                    : `✗ ${testResult.error}`}
                </div>
              )}
            </div>
          </>
        )}

        <div className="text-[11px] leading-relaxed text-ink-4">
          Key 通过系统密钥链加密存储到 ~/.claude-manager/llm-key.enc，仅本机可解。会话内容会发送到你填写的 Base URL，请确保信任该端点。
        </div>
      </div>
    </div>
  );
}
