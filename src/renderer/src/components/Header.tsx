import { RefreshCw, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import type { Source } from '../types';
import claudeIcon from '@assets/image/claude-color.svg';
import codexIcon from '@assets/image/codex-color.svg';
import UpdateIndicator from './UpdateIndicator';

type Props = {
  tab: Source;
  onTabChange: (t: Source) => void;
  onRefresh: () => void;
  onOpenTrash: () => void;
  loading: boolean;
  counts: { claude: number; codex: number };
};

export default function Header({
  tab,
  onTabChange,
  onRefresh,
  onOpenTrash,
  loading,
  counts
}: Props): JSX.Element {
  const activeIcon = tab === 'claude' ? claudeIcon : codexIcon;
  return (
    <header className="flex items-center justify-between border-b border-line bg-surface px-5 py-3">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 ring-1 ring-brand-100 transition-colors">
          <img
            key={tab}
            src={activeIcon}
            alt={tab}
            className="h-5 w-5 animate-[fadeSwap_220ms_ease-out]"
            draggable={false}
          />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-[15px] font-semibold tracking-tight text-ink-1">Recall</span>
          <span className="text-[11px] text-ink-5">AI 对话档案</span>
        </div>
      </div>

      <nav className="flex items-center gap-1 rounded-full border border-line bg-surface-sub p-1">
        <TabButton
          active={tab === 'claude'}
          onClick={() => onTabChange('claude')}
          icon={<img src={claudeIcon} alt="" className="h-3.5 w-3.5" draggable={false} />}
          label="Claude Code"
          count={counts.claude}
        />
        <TabButton
          active={tab === 'codex'}
          onClick={() => onTabChange('codex')}
          icon={<img src={codexIcon} alt="" className="h-3.5 w-3.5" draggable={false} />}
          label="Codex"
          count={counts.codex}
        />
      </nav>

      <div className="flex items-center gap-2">
        <UpdateIndicator theme={tab} />
        <IconButton title="重新扫描" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </IconButton>
        <IconButton title="打开回收站" onClick={onOpenTrash}>
          <Trash2 size={15} />
        </IconButton>
      </div>
    </header>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  count
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition',
        active ? 'bg-surface text-ink-1 shadow-sm' : 'text-ink-4 hover:text-ink-2'
      )}
    >
      <span className={clsx('flex items-center', active ? '' : 'opacity-70')}>{icon}</span>
      <span>{label}</span>
      <span
        className={clsx(
          'rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
          active ? 'bg-brand-50 text-brand-600' : 'bg-surface text-ink-5'
        )}
      >
        {count}
      </span>
    </button>
  );
}

function IconButton({
  children,
  title,
  onClick,
  disabled
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface text-ink-3 transition hover:border-line-strong hover:text-ink-1 disabled:opacity-50"
    >
      {children}
    </button>
  );
}
