import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { Settings as SettingsIcon, X } from 'lucide-react';
import type { Appearance } from '../types';
import AppearanceSection from './settings/AppearanceSection';
import TrashSection from './settings/TrashSection';
import SearchIndexSection from './settings/SearchIndexSection';
import LlmSection from './settings/LlmSection';
import TerminalSection from './settings/TerminalSection';
import AboutSection from './settings/AboutSection';
import SettingsSidebar from './settings/SettingsSidebar';
import { SECTIONS, type SectionKey } from './settings/sections';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appearance: Appearance;
  onAppearanceChange: (a: Appearance) => void;
  trashDir: string | undefined;
  onTrashDirChange: (next: string | undefined) => void;
};

export default function SettingsDialog({
  open,
  onOpenChange,
  appearance,
  onAppearanceChange,
  trashDir,
  onTrashDirChange
}: Props): JSX.Element {
  const [active, setActive] = useState<SectionKey>('appearance');
  const activeSection = SECTIONS.find((s) => s.key === active) ?? SECTIONS[0];

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay fixed inset-0 z-50 bg-ink-1/40 backdrop-blur-[2px]" />
        <Dialog.Content className="dialog-popup fixed left-1/2 top-1/2 z-50 flex h-[600px] max-h-[90vh] w-[820px] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl2 border border-line bg-surface shadow-pop outline-none">
          <SettingsSidebar active={active} onChange={setActive} />

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-start gap-3 border-b border-line px-5 py-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 ring-1 ring-brand-100">
                <SettingsIcon size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <Dialog.Title className="text-[14.5px] font-semibold text-ink-1">
                  {activeSection.label}
                </Dialog.Title>
                <Dialog.Description className="mt-0.5 text-[11.5px] text-ink-4">
                  {activeSection.desc} · 偏好保存在 ~/.claude-manager/config.json
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button
                  className="flex h-7 w-7 items-center justify-center rounded-md text-ink-5 hover:bg-surface-sub hover:text-ink-1"
                  title="关闭"
                >
                  <X size={14} />
                </button>
              </Dialog.Close>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {active === 'appearance' && (
                <AppearanceSection
                  appearance={appearance}
                  onAppearanceChange={onAppearanceChange}
                />
              )}
              {active === 'trash' && (
                <TrashSection
                  trashDir={trashDir}
                  onTrashDirChange={onTrashDirChange}
                  open={open}
                />
              )}
              {active === 'search' && <SearchIndexSection open={open} />}
              {active === 'llm' && <LlmSection open={open} />}
              {active === 'terminal' && <TerminalSection open={open} />}
              {active === 'about' && <AboutSection open={open} />}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
