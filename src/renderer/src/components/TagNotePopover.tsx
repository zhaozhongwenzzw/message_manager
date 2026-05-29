import * as Popover from '@radix-ui/react-popover';
import { useEffect, useRef, useState } from 'react';
import { Tag as TagIcon, X } from 'lucide-react';
import clsx from 'clsx';
import { tagChipTone } from '../utils/tone';

type Props = {
  tags: string[];
  note: string;
  allTags: string[];
  onSetTags: (tags: string[]) => void;
  onSetNote: (note: string) => void;
  children: React.ReactNode; // trigger button
};

export default function TagNotePopover({
  tags,
  note,
  allTags,
  onSetTags,
  onSetNote,
  children
}: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const [draftTags, setDraftTags] = useState<string[]>(tags);
  const [draftNote, setDraftNote] = useState(note);
  const [input, setInput] = useState('');

  // Reset drafts to latest props whenever the popover opens.
  useEffect(() => {
    if (open) {
      setDraftTags(tags);
      setDraftNote(note);
      setInput('');
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const committed = useRef({ tags, note });
  committed.current = { tags, note };

  const addTag = (raw: string): void => {
    const t = raw.trim();
    if (!t) return;
    setDraftTags((prev) => (prev.includes(t) ? prev : [...prev, t]));
    setInput('');
  };

  const removeTag = (t: string): void => {
    setDraftTags((prev) => prev.filter((x) => x !== t));
  };

  // Persist on close if drafts diverged from committed props.
  const flush = (): void => {
    const sameTags =
      committed.current.tags.length === draftTags.length &&
      committed.current.tags.every((t, i) => t === draftTags[i]);
    if (!sameTags) onSetTags(draftTags);
    if (committed.current.note.trim() !== draftNote.trim()) onSetNote(draftNote);
  };

  const suggestions = allTags.filter((t) => !draftTags.includes(t)).slice(0, 12);

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) flush();
        setOpen(o);
      }}
    >
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          onClick={(e) => e.stopPropagation()}
          className="z-50 w-72 rounded-xl2 border border-line bg-surface p-3 shadow-pop outline-none"
        >
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-ink-3">
            <TagIcon size={12} />
            标签
          </div>

          {draftTags.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1">
              {draftTags.map((t) => (
                <span
                  key={t}
                  className={clsx(
                    'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium',
                    tagChipTone(t)
                  )}
                >
                  {t}
                  <button
                    onClick={() => removeTag(t)}
                    className="opacity-60 transition hover:opacity-100"
                    title="移除标签"
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <input
            type="text"
            value={input}
            placeholder="输入标签名，回车添加"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addTag(input);
              } else if (e.key === 'Backspace' && !input && draftTags.length) {
                removeTag(draftTags[draftTags.length - 1]);
              }
            }}
            className="w-full rounded-lg border border-line bg-surface-sub px-2.5 py-1.5 text-[12px] text-ink-1 outline-none transition placeholder:text-ink-5 focus:border-brand focus:bg-surface"
          />

          {suggestions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {suggestions.map((t) => (
                <button
                  key={t}
                  onClick={() => addTag(t)}
                  className="inline-flex items-center rounded-md border border-line bg-surface px-1.5 py-0.5 text-[11px] text-ink-4 transition hover:border-line-strong hover:text-ink-2"
                >
                  + {t}
                </button>
              ))}
            </div>
          )}

          <div className="mb-1.5 mt-3 text-[11px] font-semibold text-ink-3">备注</div>
          <textarea
            value={draftNote}
            placeholder="给这次会话写点备注…"
            rows={3}
            onChange={(e) => setDraftNote(e.target.value)}
            className="w-full resize-none rounded-lg border border-line bg-surface-sub px-2.5 py-1.5 text-[12px] leading-relaxed text-ink-1 outline-none transition placeholder:text-ink-5 focus:border-brand focus:bg-surface"
          />

          <div className="mt-2 flex justify-end">
            <button
              onClick={() => {
                flush();
                setOpen(false);
              }}
              className="rounded-lg bg-brand-500 px-3 py-1 text-[12px] font-medium text-white transition hover:bg-brand-600"
            >
              完成
            </button>
          </div>
          <Popover.Arrow className="fill-surface" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
