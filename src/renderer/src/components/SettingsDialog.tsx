import * as Dialog from '@radix-ui/react-dialog';
import { Check, Monitor, Moon, Settings as SettingsIcon, Sun, X } from 'lucide-react';
import clsx from 'clsx';
import type { Appearance } from '../types';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appearance: Appearance;
  onAppearanceChange: (a: Appearance) => void;
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
  onAppearanceChange
}: Props): JSX.Element {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay fixed inset-0 z-50 bg-ink-1/40 backdrop-blur-[2px]" />
        <Dialog.Content className="dialog-popup fixed left-1/2 top-1/2 z-50 w-[560px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-xl2 border border-line bg-surface p-5 shadow-pop outline-none">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 ring-1 ring-brand-100">
              <SettingsIcon size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-[15px] font-semibold text-ink-1">设置</Dialog.Title>
              <Dialog.Description className="mt-1 text-[12.5px] text-ink-4">
                偏好会保存在 ~/.claude-manager/config.json
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

          <div className="mt-5">
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
