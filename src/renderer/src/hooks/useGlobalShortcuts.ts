import { useEffect } from 'react';

export type ShortcutHandlers = {
  onTogglePalette: () => void;
  onOpenSettings: () => void;
  onSwitchClaude: () => void;
  onSwitchCodex: () => void;
  onFocusSearch: () => void;
  onToggleTrash: () => void;
  onToggleStarredOnly: () => void;
  onOpenShortcutsHelp: () => void;
};

function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

export function useGlobalShortcuts(handlers: ShortcutHandlers): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const inEditable = isEditable(e.target);

      let id: string | null = null;
      let bareKey = false;
      if (mod && !e.shiftKey && !e.altKey) {
        if (key === 'k' || key === 'p') id = 'palette';
        else if (key === ',') id = 'settings';
        else if (key === '1') id = 'claude';
        else if (key === '2') id = 'codex';
        else if (key === 'f') id = 'search';
        else if (key === 'b') id = 'trash';
        else if (key === 's') id = 'starred';
      } else if (!mod && !e.altKey) {
        // '?' on most keyboards is Shift+/ — treat as a bare key.
        if (e.key === '?') {
          id = 'help';
          bareKey = true;
        }
      }

      if (!id) return;
      // Bare-key shortcuts get suppressed inside text inputs so the user can
      // type literal '?'. Modifier shortcuts (Ctrl/Cmd+...) always fire — the
      // user clearly intended a shortcut, not text entry.
      if (inEditable && bareKey) return;

      switch (id) {
        case 'palette':
          handlers.onTogglePalette();
          break;
        case 'settings':
          handlers.onOpenSettings();
          break;
        case 'claude':
          handlers.onSwitchClaude();
          break;
        case 'codex':
          handlers.onSwitchCodex();
          break;
        case 'search':
          handlers.onFocusSearch();
          break;
        case 'trash':
          handlers.onToggleTrash();
          break;
        case 'starred':
          handlers.onToggleStarredOnly();
          break;
        case 'help':
          handlers.onOpenShortcutsHelp();
          break;
      }
      e.preventDefault();
      e.stopPropagation();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlers]);
}

export function focusSearchInput(): void {
  window.dispatchEvent(new CustomEvent('recall:focus-search'));
}
