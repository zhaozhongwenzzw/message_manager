import type { Appearance } from '../../types';

export function AppearancePreview({ tone }: { tone: Appearance }): JSX.Element {
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
