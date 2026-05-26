import { Folder, Inbox, Calendar, Trash2, Settings, Archive } from 'lucide-react';
import clsx from 'clsx';
import type { Source } from '../types';

type ProjectItem = { key: string; label: string; count: number };

type Props = {
  tab: Source;
  projects: ProjectItem[];
  totalForTab: number;
  archivedCount?: number; // codex only
  selectedKey: string;
  onSelect: (key: string) => void;
  onDeleteProject?: (key: string, label: string, count: number) => void;
  onOpenSettings: () => void;
};

function avatarTone(label: string): string {
  const palette = [
    'bg-brand-50 text-brand-700',
    'bg-info-50 text-info-600',
    'bg-warn-50 text-warn-600',
    'bg-agent-50 text-agent-600',
    'bg-rose-50 text-rose-600',
    'bg-sky-50 text-sky-600',
    'bg-teal-50 text-teal-600',
    'bg-indigo-50 text-indigo-600'
  ];
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

function initials(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return '?';
  const first = trimmed[0];
  if (/[a-zA-Z]/.test(first)) return first.toUpperCase();
  return first;
}

export default function ProjectSidebar({
  tab,
  projects,
  totalForTab,
  archivedCount,
  selectedKey,
  onSelect,
  onDeleteProject,
  onOpenSettings
}: Props): JSX.Element {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-line bg-surface-sub">
      <div className="flex items-center gap-2 px-5 pt-5 pb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-5">
        {tab === 'claude' ? <Folder size={12} /> : <Calendar size={12} />}
        <span>{tab === 'claude' ? '项目' : '按月份'}</span>
        <span className="ml-auto text-ink-5">{projects.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pt-1 pb-3">
        <SidebarRow
          icon={<Inbox size={14} />}
          label="全部"
          count={totalForTab}
          active={selectedKey === '__all__'}
          onClick={() => onSelect('__all__')}
          tone="bg-ink-1/5 text-ink-2"
        />
        {tab === 'codex' && archivedCount != null && (
          <SidebarRow
            icon={<Archive size={14} />}
            label="已归档"
            count={archivedCount}
            active={selectedKey === '__archived__'}
            onClick={() => onSelect('__archived__')}
            tone="bg-ink-1/5 text-ink-2"
          />
        )}
        <div className="my-2 h-px bg-line" />
        {projects.map((p) => (
          <SidebarRow
            key={p.key}
            avatar={initials(p.label)}
            label={p.label}
            count={p.count}
            active={selectedKey === p.key}
            onClick={() => onSelect(p.key)}
            onDelete={onDeleteProject ? () => onDeleteProject(p.key, p.label, p.count) : undefined}
            tone={avatarTone(p.label)}
          />
        ))}
        {projects.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-ink-5">没有发现会话</div>
        )}
      </div>
      <div className="border-t border-line px-2 py-2">
        <button
          onClick={onOpenSettings}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink-3 transition hover:bg-surface hover:text-ink-1"
          title="打开设置"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface text-ink-4 ring-1 ring-line">
            <Settings size={14} />
          </span>
          <span className="flex-1">设置</span>
        </button>
      </div>
    </aside>
  );
}

function SidebarRow({
  icon,
  avatar,
  label,
  count,
  active,
  onClick,
  onDelete,
  tone
}: {
  icon?: React.ReactNode;
  avatar?: string;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  onDelete?: () => void;
  tone: string;
}): JSX.Element {
  return (
    <div
      className={clsx(
        'group relative mb-0.5 flex w-full items-center gap-2.5 rounded-lg pl-2.5 pr-1.5 py-2 text-left text-[13px] transition cursor-pointer',
        active
          ? 'bg-surface text-ink-1 shadow-card ring-1 ring-brand-100'
          : 'text-ink-3 hover:bg-surface/70 hover:text-ink-1'
      )}
      onClick={onClick}
      title={label}
    >
      <span
        className={clsx(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold',
          tone
        )}
      >
        {avatar ?? icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {onDelete ? (
        <>
          <span
            className={clsx(
              'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium tabular-nums transition group-hover:opacity-0',
              active ? 'bg-brand-50 text-brand-600' : 'bg-surface text-ink-5'
            )}
          >
            {count}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="absolute right-1.5 flex h-6 w-6 items-center justify-center rounded-md text-ink-5 opacity-0 transition hover:bg-danger-50 hover:text-danger-500 group-hover:opacity-100"
            title="删除整个项目"
          >
            <Trash2 size={13} />
          </button>
        </>
      ) : (
        <span
          className={clsx(
            'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium tabular-nums',
            active ? 'bg-brand-50 text-brand-600' : 'bg-surface text-ink-5'
          )}
        >
          {count}
        </span>
      )}
    </div>
  );
}
