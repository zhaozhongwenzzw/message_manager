import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import clsx from 'clsx';
import {
  Bot,
  Brain,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CheckCircle2,
  FileCode,
  FilePlus,
  FileText,
  Folder,
  Globe,
  Info,
  Layers,
  ListChecks,
  MessageSquare,
  Notebook,
  Pencil,
  Search,
  SearchCode,
  Sparkles,
  Terminal,
  User,
  Wrench
} from 'lucide-react';
import type { NormEvent } from '../types';

type Props = { evt: NormEvent };

export default function EventRenderer({ evt }: Props): JSX.Element {
  switch (evt.kind) {
    case 'user':
      return <UserMessage text={evt.text} ts={evt.ts} />;
    case 'assistant':
      return <AssistantMessage text={evt.text} ts={evt.ts} />;
    case 'thinking':
      return <Thinking text={evt.text} ts={evt.ts} />;
    case 'tool_use': {
      if (evt.name === 'Task') return <SubAgentCall input={evt.input} ts={evt.ts} />;
      return <ToolUse name={evt.name} input={evt.input} ts={evt.ts} />;
    }
    case 'tool_result':
      return <ToolResult content={evt.content} isError={evt.isError} ts={evt.ts} />;
    case 'meta':
      return <Meta raw={(evt as any).raw} />;
    case 'parse_error':
      return (
        <Card tone="danger" icon={<CircleAlert size={14} />} label="无法解析的行" ts={undefined}>
          <pre className="overflow-auto text-[11px] text-danger-600">{evt.rawLine}</pre>
        </Card>
      );
    case 'unknown':
    default:
      return <UnknownEvent raw={(evt as any).raw} />;
  }
}

// ─── Shared card ────────────────────────────────────────────────────────────────

type Tone = 'info' | 'brand' | 'warn' | 'agent' | 'think' | 'slate' | 'danger';

const toneStyles: Record<Tone, { card: string; chip: string; avatar: string; label: string }> = {
  info: {
    card: 'border-info-100/70 bg-white',
    chip: 'bg-info-50 text-info-600',
    avatar: 'bg-info-50 text-info-600 ring-1 ring-info-100',
    label: 'text-info-600'
  },
  brand: {
    card: 'border-brand-100/70 bg-white',
    chip: 'bg-brand-50 text-brand-700',
    avatar: 'bg-brand-50 text-brand-700 ring-1 ring-brand-100',
    label: 'text-brand-700'
  },
  warn: {
    card: 'border-warn-100 bg-warn-50/40',
    chip: 'bg-warn-50 text-warn-600',
    avatar: 'bg-warn-50 text-warn-600 ring-1 ring-warn-100',
    label: 'text-warn-600'
  },
  agent: {
    card: 'border-agent-100 bg-agent-50/40',
    chip: 'bg-agent-50 text-agent-600',
    avatar: 'bg-agent-50 text-agent-600 ring-1 ring-agent-100',
    label: 'text-agent-600'
  },
  think: {
    card: 'border-line bg-think-50',
    chip: 'bg-think-100 text-ink-4',
    avatar: 'bg-think-100 text-ink-4 ring-1 ring-line',
    label: 'text-ink-4'
  },
  slate: {
    card: 'border-line bg-surface-sub',
    chip: 'bg-surface text-ink-4 border border-line',
    avatar: 'bg-white text-ink-3 ring-1 ring-line',
    label: 'text-ink-3'
  },
  danger: {
    card: 'border-danger-100 bg-danger-50/40',
    chip: 'bg-danger-50 text-danger-600',
    avatar: 'bg-danger-50 text-danger-600 ring-1 ring-danger-100',
    label: 'text-danger-600'
  }
};

function Card({
  tone,
  icon,
  label,
  badge,
  ts,
  emphasize,
  children
}: {
  tone: Tone;
  icon: React.ReactNode;
  label: string;
  badge?: React.ReactNode;
  ts?: number;
  emphasize?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  const t = toneStyles[tone];
  return (
    <div
      className={clsx(
        'mb-3 rounded-xl2 border shadow-card transition',
        t.card,
        emphasize && 'ring-1 ring-agent-100'
      )}
    >
      <div className="flex items-center gap-2.5 px-4 pt-3">
        <div
          className={clsx(
            'flex h-7 w-7 items-center justify-center rounded-lg',
            t.avatar
          )}
        >
          {icon}
        </div>
        <span className={clsx('text-[12px] font-semibold uppercase tracking-wide', t.label)}>
          {label}
        </span>
        {badge}
        <span className="ml-auto text-[10.5px] text-ink-5 tabular-nums">
          {ts ? new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}
        </span>
      </div>
      <div className="px-4 pb-4 pt-2">{children}</div>
    </div>
  );
}

// ─── User / Assistant / Thinking ────────────────────────────────────────────────

function UserMessage({ text, ts }: { text: string; ts?: number }): JSX.Element {
  return (
    <Card tone="info" icon={<User size={14} />} label="用户" ts={ts}>
      <Body text={text} />
    </Card>
  );
}

function AssistantMessage({ text, ts }: { text: string; ts?: number }): JSX.Element {
  return (
    <Card tone="brand" icon={<Sparkles size={14} />} label="助手" ts={ts}>
      <Body text={text} />
    </Card>
  );
}

function Thinking({ text, ts }: { text: string; ts?: number }): JSX.Element {
  return (
    <Card tone="think" icon={<Brain size={14} />} label="思考过程" ts={ts}>
      <div className="italic">
        <Body text={text} />
      </div>
    </Card>
  );
}

function Body({ text }: { text: string }): JSX.Element {
  if (!text) return <div className="text-xs italic text-ink-5">(无文本内容)</div>;
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

// ─── Tool use ───────────────────────────────────────────────────────────────────

function toolIcon(name: string): React.ReactNode {
  const map: Record<string, React.ReactNode> = {
    Bash: <Terminal size={14} />,
    BashOutput: <Terminal size={14} />,
    KillShell: <Terminal size={14} />,
    Read: <FileText size={14} />,
    Edit: <Pencil size={14} />,
    Write: <FilePlus size={14} />,
    Glob: <Search size={14} />,
    Grep: <SearchCode size={14} />,
    WebFetch: <Globe size={14} />,
    WebSearch: <Globe size={14} />,
    TodoWrite: <ListChecks size={14} />,
    NotebookEdit: <Notebook size={14} />,
    Task: <Bot size={14} />,
    ExitPlanMode: <Layers size={14} />
  };
  return map[name] ?? <Wrench size={14} />;
}

function summarizeInput(name: string, input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const i = input as Record<string, any>;
  switch (name) {
    case 'Bash':
      return String(i.command ?? '').slice(0, 200);
    case 'BashOutput':
      return `shell_id: ${i.bash_id ?? i.shell_id ?? ''}`;
    case 'KillShell':
      return `shell_id: ${i.shell_id ?? i.bash_id ?? ''}`;
    case 'Read':
      return String(i.file_path ?? '');
    case 'Write':
      return String(i.file_path ?? '');
    case 'Edit':
      return String(i.file_path ?? '');
    case 'Glob':
      return String(i.pattern ?? '');
    case 'Grep': {
      const flags: string[] = [];
      if (i.glob) flags.push(`glob=${i.glob}`);
      if (i.type) flags.push(`type=${i.type}`);
      return `${i.pattern ?? ''}  ${flags.join(' ')}`;
    }
    case 'WebFetch':
    case 'WebSearch':
      return String(i.url ?? i.query ?? '');
    case 'TodoWrite':
      return Array.isArray(i.todos) ? `${i.todos.length} 项` : '';
    case 'NotebookEdit':
      return String(i.notebook_path ?? '');
    default:
      return '';
  }
}

function ToolUse({
  name,
  input,
  ts
}: {
  name: string;
  input: unknown;
  ts?: number;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const summary = summarizeInput(name, input);
  return (
    <Card
      tone="warn"
      icon={toolIcon(name)}
      label="工具调用"
      ts={ts}
      badge={
        <span className="rounded-md bg-white px-2 py-0.5 text-[11px] font-semibold text-warn-600 ring-1 ring-warn-100">
          {name}
        </span>
      }
    >
      {summary && (
        <div className="mb-2 truncate rounded-md bg-white px-3 py-1.5 font-mono text-[12px] text-ink-2 ring-1 ring-warn-100">
          {summary}
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-[11px] text-ink-4 hover:text-ink-2"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {open ? '收起完整输入' : '查看完整输入'}
      </button>
      {open && (
        <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-white p-3 text-[11px] text-ink-3 ring-1 ring-line">
          {safeStringify(input)}
        </pre>
      )}
    </Card>
  );
}

// ─── Sub-agent (Task tool) — visually distinct ─────────────────────────────────

function SubAgentCall({ input, ts }: { input: unknown; ts?: number }): JSX.Element {
  const [open, setOpen] = useState(false);
  const i = (input ?? {}) as Record<string, any>;
  const subType = i.subagent_type ?? 'general-purpose';
  const description = i.description ?? '';
  const prompt = String(i.prompt ?? '');

  return (
    <Card
      tone="agent"
      icon={<Bot size={14} />}
      label="子代理调用"
      ts={ts}
      emphasize
      badge={
        <span className="rounded-md bg-white px-2 py-0.5 text-[11px] font-semibold text-agent-600 ring-1 ring-agent-100">
          {subType}
        </span>
      }
    >
      {description && (
        <div className="mb-2 text-[13px] font-medium text-ink-1">{description}</div>
      )}
      {prompt && (
        <>
          <div className="relative rounded-lg bg-white p-3 text-[12.5px] text-ink-2 ring-1 ring-agent-100">
            <div className="absolute left-0 top-2 bottom-2 w-[3px] rounded bg-agent" />
            <div className="pl-3">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-agent-600">
                子代理任务
              </div>
              <div className="whitespace-pre-wrap leading-relaxed">
                {open || prompt.length <= 400 ? prompt : prompt.slice(0, 400) + '…'}
              </div>
            </div>
          </div>
          {prompt.length > 400 && (
            <button
              onClick={() => setOpen((v) => !v)}
              className="mt-2 inline-flex items-center gap-1 text-[11px] text-agent-600 hover:text-agent-700"
            >
              {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {open ? '折叠' : '展开全部任务描述'}
            </button>
          )}
        </>
      )}
    </Card>
  );
}

// ─── Tool result ────────────────────────────────────────────────────────────────

function ToolResult({
  content,
  isError,
  ts
}: {
  content: string;
  isError?: boolean;
  ts?: number;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const truncated = content.length > 800 ? content.slice(0, 800) + '\n\n…' : content;
  return (
    <Card
      tone={isError ? 'danger' : 'slate'}
      icon={isError ? <CircleAlert size={14} /> : <CheckCircle2 size={14} />}
      label={isError ? '工具执行失败' : '工具结果'}
      ts={ts}
    >
      <pre className="overflow-auto whitespace-pre-wrap rounded-md bg-white p-3 font-mono text-[11.5px] text-ink-2 ring-1 ring-line">
        {open ? content : truncated}
      </pre>
      {content.length > 800 && (
        <button
          onClick={() => setOpen((v) => !v)}
          className="mt-2 inline-flex items-center gap-1 text-[11px] text-ink-4 hover:text-ink-2"
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {open ? '折叠' : `展开全部 (${content.length.toLocaleString()} 字)`}
        </button>
      )}
    </Card>
  );
}

// ─── Meta / Unknown ─────────────────────────────────────────────────────────────

function Meta({ raw }: { raw: any }): JSX.Element {
  return (
    <details className="mb-2 rounded-lg border border-line bg-surface-sub px-3 py-1.5">
      <summary className="cursor-pointer text-[11px] text-ink-5">
        <Info size={11} className="-mt-0.5 mr-1 inline" />
        元数据 · {raw?.type ?? raw?.payload?.type ?? 'meta'}
      </summary>
      <pre className="mt-2 overflow-auto text-[10.5px] text-ink-4">
        {safeStringify(raw)}
      </pre>
    </details>
  );
}

function UnknownEvent({ raw }: { raw: any }): JSX.Element {
  return (
    <details className="mb-2 rounded-lg border border-line bg-surface-sub px-3 py-1.5">
      <summary className="cursor-pointer text-[11px] text-ink-5">
        未识别事件 · {raw?.type ?? '?'}
      </summary>
      <pre className="mt-2 overflow-auto text-[10.5px] text-ink-4">
        {safeStringify(raw)}
      </pre>
    </details>
  );
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
