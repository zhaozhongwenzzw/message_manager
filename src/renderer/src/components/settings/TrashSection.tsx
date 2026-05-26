import { useEffect, useState } from 'react';
import { ExternalLink, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { api } from '../../api';

type Props = {
  trashDir: string | undefined;
  onTrashDirChange: (next: string | undefined) => void;
  open: boolean;
};

export default function TrashSection({ trashDir, onTrashDirChange, open }: Props): JSX.Element {
  const [defaultPath, setDefaultPath] = useState<string>('');
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    api.trashDefaultPath().then(setDefaultPath).catch(() => {});
    setErrMsg(null);
  }, [open]);

  const effectivePath = trashDir?.trim() || defaultPath;
  const isCustom = !!trashDir?.trim();

  async function handlePick(): Promise<void> {
    setErrMsg(null);
    const res = await api.pickFolder({
      defaultPath: effectivePath,
      title: '选择回收站文件夹'
    });
    if (!res) return;
    if (res.error) {
      setErrMsg(res.error);
      return;
    }
    if (res.path) onTrashDirChange(res.path);
  }

  function handleReset(): void {
    setErrMsg(null);
    onTrashDirChange(undefined);
  }

  function handleOpen(): void {
    if (effectivePath) void api.revealPath(effectivePath);
  }

  return (
    <div className="rounded-xl2 border border-line bg-surface-sub p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[12px] font-medium text-ink-2">回收站路径</div>
        {isCustom && (
          <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-600">
            自定义
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Trash2 size={14} className="shrink-0 text-ink-4" />
        <div
          className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-2"
          title={effectivePath}
        >
          {effectivePath || '加载中...'}
        </div>
        <button
          onClick={handlePick}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-ink-3 transition hover:border-brand hover:text-brand-600"
          title="修改路径"
        >
          <Pencil size={12} />
        </button>
        <button
          onClick={handleOpen}
          disabled={!effectivePath}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-ink-3 transition hover:border-line-strong hover:text-ink-1 disabled:opacity-50"
          title="在文件管理器中打开"
        >
          <ExternalLink size={12} />
        </button>
        {isCustom && (
          <button
            onClick={handleReset}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-ink-3 transition hover:border-line-strong hover:text-ink-1"
            title="恢复默认"
          >
            <RotateCcw size={12} />
          </button>
        )}
      </div>
      {errMsg && (
        <div className="mt-2 rounded border border-danger-100 bg-danger-50 px-2.5 py-1.5 text-[11.5px] text-danger-600">
          {errMsg}
        </div>
      )}
      <div className="mt-2 text-[11px] leading-relaxed text-ink-4">
        之后删除的会话写入这里 · 修改不会移动旧文件 · 不能选源目录
      </div>
    </div>
  );
}
