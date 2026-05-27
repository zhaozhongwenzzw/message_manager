import { useEffect, useState } from 'react';
import { FileSearch, Terminal } from 'lucide-react';
import { api } from '../../api';
import type { AppConfig, TerminalConfig } from '../../types';

type Props = { open: boolean };

type FieldKey = 'claudePath' | 'codexPath';

export default function TerminalSection({ open }: Props): JSX.Element {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [draft, setDraft] = useState<TerminalConfig>({});

  useEffect(() => {
    if (!open) return;
    void api
      .getConfig()
      .then((c) => {
        setCfg(c);
        setDraft({
          claudePath: c.terminal?.claudePath ?? '',
          codexPath: c.terminal?.codexPath ?? ''
        });
      })
      .catch(() => setCfg(null));
  }, [open]);

  async function commit(field: FieldKey, value: string): Promise<void> {
    if (!cfg) return;
    const trimmed = value.trim();
    const nextTerminal: TerminalConfig = {
      ...(cfg.terminal ?? {}),
      [field]: trimmed || undefined
    };
    const next = { ...cfg, terminal: nextTerminal };
    try {
      await api.setConfig(next);
      setCfg(next);
    } catch {
      // ignore; the field will reset on next open via getConfig
    }
  }

  async function pick(field: FieldKey, title: string): Promise<void> {
    const res = await api.pickFile({ title });
    if (!res?.path) return;
    setDraft((d) => ({ ...d, [field]: res.path }));
    await commit(field, res.path);
  }

  if (!cfg) {
    return (
      <div className="rounded-xl2 border border-line bg-surface-sub p-3 text-[12px] text-ink-5">
        加载中...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <PathField
        label="Claude CLI 路径"
        value={draft.claudePath ?? ''}
        placeholder="留空 = 使用 PATH 中的 claude"
        hint='例如 C:\Users\me\AppData\Roaming\npm\claude.cmd 或 /usr/local/bin/claude'
        onChange={(v) => setDraft((d) => ({ ...d, claudePath: v }))}
        onBlur={() => void commit('claudePath', draft.claudePath ?? '')}
        onPick={() => void pick('claudePath', '选择 claude 可执行文件')}
      />
      <PathField
        label="Codex CLI 路径"
        value={draft.codexPath ?? ''}
        placeholder="留空 = 使用 PATH 中的 codex"
        hint="例如 /usr/local/bin/codex"
        onChange={(v) => setDraft((d) => ({ ...d, codexPath: v }))}
        onBlur={() => void commit('codexPath', draft.codexPath ?? '')}
        onPick={() => void pick('codexPath', '选择 codex 可执行文件')}
      />
      <div className="rounded-xl2 border border-line bg-surface-sub p-3 text-[11.5px] leading-relaxed text-ink-4">
        <div className="mb-1 flex items-center gap-1.5 font-medium text-ink-2">
          <Terminal size={12} />
          关于终端启动
        </div>
        当前自动使用平台默认终端：Windows Terminal → cmd / Terminal.app / gnome-terminal → konsole → xfce4-terminal → xterm。点会话卡上的{' '}
        <Terminal size={11} className="-mb-0.5 inline" /> 按钮，会在原工作目录里执行{' '}
        <code className="rounded bg-surface px-1 py-0.5 font-mono text-[10.5px]">claude --resume &lt;id&gt;</code>{' '}
        或{' '}
        <code className="rounded bg-surface px-1 py-0.5 font-mono text-[10.5px]">codex resume &lt;id&gt;</code>
        。
      </div>
    </div>
  );
}

function PathField({
  label,
  value,
  placeholder,
  hint,
  onChange,
  onBlur,
  onPick
}: {
  label: string;
  value: string;
  placeholder: string;
  hint: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  onPick: () => void;
}): JSX.Element {
  return (
    <div className="rounded-xl2 border border-line bg-surface-sub p-3">
      <div className="mb-1.5 text-[12px] font-medium text-ink-2">{label}</div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          className="flex-1 rounded-md border border-line bg-surface px-2.5 py-1.5 font-mono text-[12px] text-ink-1 outline-none transition focus:border-brand"
        />
        <button
          onClick={onPick}
          className="flex h-8 items-center gap-1 rounded-md border border-line bg-surface px-2.5 text-[12px] text-ink-3 transition hover:border-brand hover:text-brand-600"
          title="选择文件"
        >
          <FileSearch size={12} />
          选择
        </button>
      </div>
      <div className="mt-1.5 text-[11px] leading-relaxed text-ink-5">{hint}</div>
    </div>
  );
}
