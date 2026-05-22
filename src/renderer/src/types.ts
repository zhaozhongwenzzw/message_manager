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

export type Appearance = 'light' | 'dark' | 'system';

export type AppConfig = {
  activeTab: 'claude' | 'codex';
  windowBounds?: { x?: number; y?: number; width: number; height: number };
  showStarredOnly: boolean;
  appearance: Appearance;
};

export type UpdateInfoLite = {
  version: string;
  releaseDate?: string;
  releaseNotes?: string;
};

export type UpdateProgress = {
  bytesPerSecond: number;
  percent: number;
  transferred: number;
  total: number;
};

export type UpdaterStatus =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'available'; info: UpdateInfoLite }
  | { phase: 'not-available'; info?: UpdateInfoLite; checkedAt: number }
  | { phase: 'downloading'; info: UpdateInfoLite; progress: UpdateProgress }
  | { phase: 'downloaded'; info: UpdateInfoLite }
  | { phase: 'error'; message: string };
