import { createReadStream, promises as fs } from 'node:fs';
import { createInterface } from 'node:readline';

export type NormEvent =
  | { kind: 'meta'; raw: any; index: number; ts?: number }
  | { kind: 'user'; text: string; raw: any; index: number; ts?: number }
  | { kind: 'assistant'; text: string; raw: any; index: number; ts?: number }
  | { kind: 'tool_use'; name: string; input: any; raw: any; index: number; ts?: number }
  | { kind: 'tool_result'; content: string; isError?: boolean; raw: any; index: number; ts?: number }
  | { kind: 'thinking'; text: string; raw: any; index: number; ts?: number }
  | { kind: 'unknown'; raw: any; index: number; ts?: number }
  | { kind: 'parse_error'; rawLine: string; index: number };

function extractText(content: unknown): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b: any) => {
        if (typeof b === 'string') return b;
        if (b?.type === 'text') return b.text ?? '';
        if (typeof b?.text === 'string') return b.text;
        return '';
      })
      .filter(Boolean)
      .join('\n\n');
  }
  if (typeof content === 'object' && content && 'text' in (content as any)) {
    return String((content as any).text);
  }
  return '';
}

function parseTs(v: any): number | undefined {
  if (!v) return undefined;
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : t;
}

export async function readSession(filePath: string): Promise<NormEvent[]> {
  await fs.access(filePath);
  const stream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  const events: NormEvent[] = [];
  let idx = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    let evt: any;
    try {
      evt = JSON.parse(line);
    } catch {
      events.push({ kind: 'parse_error', rawLine: line, index: idx++ });
      continue;
    }
    events.push(normalize(evt, idx++));
  }
  return events;
}

function normalize(evt: any, index: number): NormEvent {
  const ts = parseTs(evt.timestamp ?? evt.payload?.timestamp);

  // Claude shape
  if (evt.type === 'user') {
    const content = evt.message?.content;
    // Could contain tool_result blocks (when assistant tool needs a reply)
    if (Array.isArray(content) && content.some((b: any) => b?.type === 'tool_result')) {
      const tr = content.find((b: any) => b?.type === 'tool_result');
      return {
        kind: 'tool_result',
        content: extractText(tr?.content) || JSON.stringify(tr?.content ?? ''),
        isError: !!tr?.is_error,
        raw: evt,
        index,
        ts
      };
    }
    return { kind: 'user', text: extractText(content), raw: evt, index, ts };
  }
  if (evt.type === 'assistant') {
    const content = evt.message?.content;
    // tool_use lives inside assistant blocks for Claude
    if (Array.isArray(content)) {
      const tu = content.find((b: any) => b?.type === 'tool_use');
      if (tu) {
        return {
          kind: 'tool_use',
          name: tu.name ?? 'unknown',
          input: tu.input ?? {},
          raw: evt,
          index,
          ts
        };
      }
      const think = content.find((b: any) => b?.type === 'thinking');
      if (think) {
        return { kind: 'thinking', text: think.thinking ?? '', raw: evt, index, ts };
      }
    }
    return { kind: 'assistant', text: extractText(content), raw: evt, index, ts };
  }
  if (evt.type === 'permission-mode' || evt.type === 'file-history-snapshot') {
    return { kind: 'meta', raw: evt, index, ts };
  }

  // Codex shapes
  if (evt.type === 'session_meta') {
    return { kind: 'meta', raw: evt, index, ts };
  }
  if (evt.type === 'response_item' || evt.type === 'event_msg') {
    const payload = evt.payload ?? evt;
    const ptype = payload?.type;
    if (ptype === 'message') {
      const role = payload.role;
      const text = extractText(payload.content);
      if (role === 'user') return { kind: 'user', text, raw: evt, index, ts };
      if (role === 'assistant') return { kind: 'assistant', text, raw: evt, index, ts };
    }
    if (ptype === 'reasoning') {
      const text = extractText(payload.content ?? payload.summary);
      return { kind: 'thinking', text, raw: evt, index, ts };
    }
    if (ptype === 'function_call' || ptype === 'tool_call' || ptype === 'local_shell_call') {
      const name = payload.name ?? payload.tool_name ?? ptype;
      const input = payload.arguments ?? payload.input ?? payload.action ?? {};
      return { kind: 'tool_use', name, input, raw: evt, index, ts };
    }
    if (ptype === 'function_call_output' || ptype === 'tool_call_output' || ptype === 'local_shell_call_output') {
      const out = payload.output ?? payload.content ?? '';
      return {
        kind: 'tool_result',
        content: typeof out === 'string' ? out : JSON.stringify(out),
        raw: evt,
        index,
        ts
      };
    }
  }
  if (evt.role === 'user' && evt.content) {
    return { kind: 'user', text: extractText(evt.content), raw: evt, index, ts };
  }
  if (evt.role === 'assistant' && evt.content) {
    return { kind: 'assistant', text: extractText(evt.content), raw: evt, index, ts };
  }

  return { kind: 'unknown', raw: evt, index, ts };
}
