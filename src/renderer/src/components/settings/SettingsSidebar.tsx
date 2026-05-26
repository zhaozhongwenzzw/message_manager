import clsx from 'clsx';
import { SECTIONS, type SectionKey } from './sections';

type Props = {
  active: SectionKey;
  onChange: (key: SectionKey) => void;
};

export default function SettingsSidebar({ active, onChange }: Props): JSX.Element {
  return (
    <nav className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-line bg-surface-sub px-2 py-3">
      {SECTIONS.map((s) => {
        const isActive = s.key === active;
        return (
          <button
            key={s.key}
            onClick={() => onChange(s.key)}
            className={clsx(
              'flex items-center gap-2 rounded-md px-2.5 py-2 text-left transition',
              isActive
                ? 'bg-brand-50 text-brand-700'
                : 'text-ink-3 hover:bg-surface hover:text-ink-1'
            )}
          >
            <span
              className={clsx(
                'flex h-7 w-7 items-center justify-center rounded-md',
                isActive ? 'bg-white text-brand-600 ring-1 ring-brand-100' : 'text-ink-4'
              )}
            >
              {s.icon}
            </span>
            <span className="min-w-0 flex-1">
              <div className={clsx('text-[12.5px] font-medium', isActive ? 'text-brand-700' : 'text-ink-2')}>
                {s.label}
              </div>
              <div className="text-[10.5px] text-ink-5">{s.desc}</div>
            </span>
          </button>
        );
      })}
    </nav>
  );
}
