import * as Dialog from '@radix-ui/react-dialog';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CircleAlert, Trash2 } from 'lucide-react';
import clsx from 'clsx';

export type ConfirmOptions = {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'brand';
  icon?: React.ReactNode;
};

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmContext);
  if (!fn) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return fn;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [state, setState] = useState<(ConfirmOptions & { open: boolean }) | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setState({ ...opts, open: true });
    });
  }, []);

  const handle = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setState((s) => (s ? { ...s, open: false } : null));
  }, []);

  const ctx = useMemo(() => confirm, [confirm]);
  const tone = state?.tone ?? 'danger';
  const isDanger = tone === 'danger';

  return (
    <ConfirmContext.Provider value={ctx}>
      {children}
      <Dialog.Root
        open={!!state?.open}
        onOpenChange={(o) => {
          if (!o) handle(false);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay fixed inset-0 z-50 bg-ink-1/40 backdrop-blur-[2px]" />
          <Dialog.Content
            className="dialog-popup fixed left-1/2 top-1/2 z-50 w-[440px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-xl2 border border-line bg-surface p-5 shadow-pop outline-none"
            onEscapeKeyDown={() => handle(false)}
          >
            <div className="flex items-start gap-3">
              <div
                className={clsx(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
                  isDanger
                    ? 'bg-danger-50 text-danger-500 ring-1 ring-danger-100'
                    : 'bg-brand-50 text-brand-600 ring-1 ring-brand-100'
                )}
              >
                {state?.icon ?? (isDanger ? <Trash2 size={18} /> : <CircleAlert size={18} />)}
              </div>
              <div className="min-w-0 flex-1">
                <Dialog.Title className="text-[15px] font-semibold text-ink-1">
                  {state?.title}
                </Dialog.Title>
                {state?.description && (
                  <Dialog.Description asChild>
                    <div className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-ink-3">
                      {state.description}
                    </div>
                  </Dialog.Description>
                )}
              </div>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={() => handle(false)}
                className="rounded-lg border border-line bg-surface px-4 py-1.5 text-[13px] font-medium text-ink-3 transition hover:border-line-strong hover:text-ink-1"
              >
                {state?.cancelLabel ?? '取消'}
              </button>
              <button
                onClick={() => handle(true)}
                autoFocus
                className={clsx(
                  'rounded-lg px-4 py-1.5 text-[13px] font-semibold text-white transition',
                  isDanger
                    ? 'bg-danger-500 hover:bg-danger-600'
                    : 'bg-brand-500 hover:bg-brand-600'
                )}
              >
                {state?.confirmLabel ?? '确认'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </ConfirmContext.Provider>
  );
}
