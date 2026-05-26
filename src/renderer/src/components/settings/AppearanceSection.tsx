import { Check, Monitor, Moon, Sun } from 'lucide-react';
import clsx from 'clsx';
import type { Appearance } from '../../types';
import { AppearancePreview } from './AppearancePreview';

const OPTIONS: Array<{
  value: Appearance;
  label: string;
  desc: string;
  icon: JSX.Element;
}> = [
  {
    value: 'light',
    label: '浅色',
    desc: '白色简约，适合白天工作',
    icon: <Sun size={14} />
  },
  {
    value: 'dark',
    label: '深色',
    desc: '深色背景，长时间使用更护眼',
    icon: <Moon size={14} />
  },
  {
    value: 'system',
    label: '跟随系统',
    desc: '随系统的浅/深色偏好自动切换',
    icon: <Monitor size={14} />
  }
];

type Props = {
  appearance: Appearance;
  onAppearanceChange: (a: Appearance) => void;
};

export default function AppearanceSection({
  appearance,
  onAppearanceChange
}: Props): JSX.Element {
  return (
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
            <div className="px-3 pt-3">
              <AppearancePreview tone={opt.value} />
            </div>
            <div className="flex items-center gap-1.5 px-3 pb-3 pt-2">
              <span
                className={clsx('flex items-center', active ? 'text-brand-600' : 'text-ink-5')}
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
  );
}
