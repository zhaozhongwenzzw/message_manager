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
  archived?: boolean;
  cwd?: string;
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
  trashDir?: string;
  codexGrouping?: 'month' | 'project';
  terminal?: TerminalConfig;
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
  | { phase: 'pending-publish'; info?: UpdateInfoLite; message: string }
  | { phase: 'error'; message: string };

export type TrashEntry = {
  id: string;
  source: Source;
  kind: 'session' | 'project';
  trashPath: string;
  originalPath: string;
  originalLabel: string;
  deletedAt: number;
  size: number;
  preview?: string;
  messageCount?: number;
  childCount?: number;
};

export type RestoreResult =
  | { ok: true; restoredPath: string }
  | { conflict: true; originalPath: string };

export type SearchMatch = {
  eventIndex: number;
  kind: NormEvent['kind'];
  excerpt: string;
  score: number;
};

export type SearchHit = {
  sessionPath: string;
  source: Source;
  projectKey: string;
  projectLabel: string;
  ts?: number;
  matches: SearchMatch[];
  bestScore: number;
};

export type SearchStatus = {
  indexedSessions: number;
  totalDocs: number;
  lastBuildAt?: number;
  building: boolean;
  buildProgress?: { done: number; total: number };
};

export type LlmConfig = {
  enabled: boolean;
  baseUrl: string;
  model: string;
  contextWindow: number;
  hasApiKey?: boolean;
};

export type LlmTestResult =
  | { ok: true; modelInfo?: string }
  | { ok: false; error: string };

export type LlmStreamEvent =
  | {
      type: 'phase';
      streamId: string;
      phase: 'reading' | 'preparing' | 'refining' | 'generating';
      status: 'running' | 'done' | 'error';
      meta?: Record<string, unknown>;
    }
  | { type: 'token'; streamId: string; delta: string }
  | {
      type: 'done';
      streamId: string;
      fullText: string;
      usage?: { inputTokens?: number; outputTokens?: number };
    }
  | { type: 'error'; streamId: string; message: string };

export type TerminalConfig = {
  claudePath?: string;
  codexPath?: string;
};

export type OpenTerminalError =
  | { code: 'cwd_missing'; cwd: string }
  | { code: 'cwd_not_set' }
  | { code: 'cli_not_found'; cli: 'claude' | 'codex' }
  | { code: 'session_id_invalid'; raw: string }
  | { code: 'terminal_spawn_failed'; detail: string };

export type OpenTerminalResult =
  | { ok: true }
  | { ok: false; error: OpenTerminalError };
