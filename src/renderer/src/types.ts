export type Source = 'claude' | 'codex';

export type SessionSummary = {
  source: Source;
  path: string;
  id: string;
  preview: string;
  timestamp: number;
  size: number;
  messageCount: number;
  projectKey: string;
  projectLabel: string;
};

export type ClaudeProject = {
  key: string;
  label: string;
  cwd?: string;
  sessions: SessionSummary[];
};

export type NormEvent =
  | { kind: 'meta'; raw: unknown; index: number; ts?: number }
  | { kind: 'user'; text: string; raw: unknown; index: number; ts?: number }
  | { kind: 'assistant'; text: string; raw: unknown; index: number; ts?: number }
  | { kind: 'tool_use'; name: string; input: unknown; raw: unknown; index: number; ts?: number }
  | {
      kind: 'tool_result';
      content: string;
      isError?: boolean;
      raw: unknown;
      index: number;
      ts?: number;
    }
  | { kind: 'thinking'; text: string; raw: unknown; index: number; ts?: number }
  | { kind: 'unknown'; raw: unknown; index: number; ts?: number }
  | { kind: 'parse_error'; rawLine: string; index: number };

export type AppConfig = {
  activeTab: 'claude' | 'codex';
  windowBounds?: { x?: number; y?: number; width: number; height: number };
  showStarredOnly: boolean;
};
