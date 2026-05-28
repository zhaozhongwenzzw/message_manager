import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import type { Appearance, ClaudeProject, SearchHit, SessionSummary, Source } from './types';
import Header from './components/Header';
import ProjectSidebar from './components/ProjectSidebar';
import SessionList from './components/SessionList';
import DetailDrawer from './components/DetailDrawer';
import SettingsDialog from './components/SettingsDialog';
import SummarizeDialog from './components/SummarizeDialog';
import TrashView from './components/TrashView';
import CommandPalette from './components/CommandPalette';
import { useConfirm } from './components/ConfirmDialog';
import { focusSearchInput, useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { translateTerminalError } from './utils/terminalError';

type ScanState = {
  loading: boolean;
  claude: ClaudeProject[];
  codex: SessionSummary[];
  stars: Record<string, boolean>;
};

const INITIAL_SCAN: ScanState = { loading: true, claude: [], codex: [], stars: {} };

export default function App(): JSX.Element {
  const [tab, setTab] = useState<Source>('claude');
  const [view, setView] = useState<'main' | 'trash'>('main');
  const [scan, setScan] = useState<ScanState>(INITIAL_SCAN);
  const [query, setQuery] = useState('');
  const [starredOnly, setStarredOnly] = useState(false);
  const [selectedProjectKey, setSelectedProjectKey] = useState<string>('__all__');
  const [openSession, setOpenSession] = useState<SessionSummary | null>(null);
  const [openJump, setOpenJump] = useState<{ eventIndex?: number; query?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [appearance, setAppearance] = useState<Appearance>('system');
  const [trashDir, setTrashDir] = useState<string | undefined>(undefined);
  const [codexGrouping, setCodexGrouping] = useState<'month' | 'project'>('month');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [summarizeTarget, setSummarizeTarget] = useState<SessionSummary | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteInitialView, setPaletteInitialView] = useState<'commands' | 'shortcuts'>('commands');
  const [searchHits, setSearchHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchSeq = useRef(0);
  const confirm = useConfirm();

  // Tab-aware theme: claude=orange, codex=blue
  useEffect(() => {
    document.documentElement.dataset.theme = tab;
  }, [tab]);

  // Appearance: light / dark / system. Resolve "system" via matchMedia and
  // re-resolve when the OS preference changes.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (): void => {
      const resolved =
        appearance === 'system' ? (mq.matches ? 'dark' : 'light') : appearance;
      document.documentElement.dataset.appearance = resolved;
    };
    apply();
    if (appearance === 'system') {
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
    return undefined;
  }, [appearance]);

  const refresh = useCallback(async () => {
    setScan((s) => ({ ...s, loading: true }));
    try {
      const [claude, codex, stars] = await Promise.all([
        api.scanClaude(),
        api.scanCodex(),
        api.listStars()
      ]);
      setScan({ loading: false, claude, codex, stars });
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setScan((s) => ({ ...s, loading: false }));
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const cfg = await api.getConfig();
        setTab(cfg.activeTab);
        setStarredOnly(cfg.showStarredOnly);
        setAppearance(cfg.appearance);
        setTrashDir(cfg.trashDir);
        if (cfg.codexGrouping) setCodexGrouping(cfg.codexGrouping);
      } catch {
        // first run
      }
      await refresh();
    })();
  }, [refresh]);

  useEffect(() => {
    api
      .getConfig()
      .then((cfg) =>
        api.setConfig({
          ...cfg,
          activeTab: tab,
          showStarredOnly: starredOnly,
          appearance,
          trashDir,
          codexGrouping
        })
      )
      .catch(() => {});
  }, [tab, starredOnly, appearance, trashDir, codexGrouping]);

  const allSessions = useMemo<SessionSummary[]>(() => {
    if (tab === 'claude') return scan.claude.flatMap((p) => p.sessions);
    return scan.codex;
  }, [tab, scan]);

  // Codex: count of archived sessions for sidebar badge
  const archivedCodexCount = useMemo(
    () => scan.codex.filter((s) => s.archived).length,
    [scan.codex]
  );

  const projects = useMemo(() => {
    if (tab === 'claude') {
      return scan.claude.map((p) => ({ key: p.key, label: p.label, count: p.sessions.length }));
    }
    // Codex 月份桶 / 项目桶都只算非归档会话，归档单独入桶。
    const active = scan.codex.filter((s) => !s.archived);
    if (codexGrouping === 'project') {
      // Bucket by cwd. Sessions without cwd land under a synthetic "未知项目" bucket.
      const UNKNOWN = '__no_cwd__';
      const map = new Map<string, { label: string; count: number }>();
      for (const s of active) {
        const key = s.cwd?.trim() || UNKNOWN;
        const label =
          key === UNKNOWN
            ? '未知项目'
            : s.projectLabel && s.projectLabel !== s.projectKey
              ? s.projectLabel
              : key;
        const cur = map.get(key);
        if (cur) cur.count++;
        else map.set(key, { label, count: 1 });
      }
      // Sort by count desc, unknown bucket last.
      return [...map.entries()]
        .sort(([ak, av], [bk, bv]) => {
          if (ak === UNKNOWN) return 1;
          if (bk === UNKNOWN) return -1;
          return bv.count - av.count;
        })
        .map(([k, v]) => ({ key: k, label: v.label, count: v.count }));
    }
    // Default: bucket by YYYY-MM.
    const map = new Map<string, number>();
    for (const s of active) map.set(s.projectKey, (map.get(s.projectKey) ?? 0) + 1);
    return [...map.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([k, v]) => ({ key: k, label: k, count: v }));
  }, [tab, scan, codexGrouping]);

  const filtered = useMemo(() => {
    let list = allSessions;
    if (selectedProjectKey === '__archived__') {
      list = list.filter((s) => s.archived);
    } else if (selectedProjectKey === '__all__') {
      // 「全部」也不含归档，避免月份桶之和与「全部」不一致
      if (tab === 'codex') list = list.filter((s) => !s.archived);
    } else {
      if (tab === 'codex' && codexGrouping === 'project') {
        // selectedProjectKey is a cwd (or '__no_cwd__' sentinel)
        list = list.filter((s) => {
          if (s.archived) return false;
          const k = s.cwd?.trim() || '__no_cwd__';
          return k === selectedProjectKey;
        });
      } else {
        list = list.filter((s) => s.projectKey === selectedProjectKey && !s.archived);
      }
    }
    if (starredOnly) list = list.filter((s) => scan.stars[s.path]);
    return list;
  }, [allSessions, selectedProjectKey, starredOnly, scan.stars, tab, codexGrouping]);

  // Full-text search: debounce 200ms, kick off when query is non-trivial.
  // 1 ASCII char or 1 CJK char alone is too noisy — require at least 2 chars
  // OR a multi-char query that tokenizes to something searchable.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setSearchHits(null);
      setSearchError(null);
      setSearching(false);
      return;
    }
    // Single CJK char or single ASCII char → too broad
    if (q.length < 2) {
      setSearchHits([]);
      setSearchError('请输入至少 2 个字符');
      setSearching(false);
      return;
    }
    setSearching(true);
    setSearchError(null);
    const seq = ++searchSeq.current;
    const t = window.setTimeout(async () => {
      try {
        const hits = await api.searchQuery({ query: q, source: tab });
        if (seq !== searchSeq.current) return;
        setSearchHits(hits);
      } catch (e: any) {
        if (seq !== searchSeq.current) return;
        setSearchError(`搜索失败: ${e?.message ?? String(e)}`);
        setSearchHits([]);
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 200);
    return () => window.clearTimeout(t);
  }, [query, tab]);

  // Client-side post-filter on search hits: respect project selection + starred-only.
  const filteredHits = useMemo<SearchHit[] | null>(() => {
    if (!searchHits) return null;
    let list = searchHits;
    if (selectedProjectKey === '__archived__') {
      list = list.filter((h) => h.sessionPath.includes('archived_sessions'));
    } else if (selectedProjectKey === '__all__') {
      if (tab === 'codex') list = list.filter((h) => !h.sessionPath.includes('archived_sessions'));
    } else if (tab === 'codex' && codexGrouping === 'project') {
      // Need to look up cwd via the session summary — search index doesn't
      // carry cwd.
      const cwdByPath = new Map(scan.codex.map((s) => [s.path, s.cwd?.trim() || '__no_cwd__']));
      list = list.filter((h) => {
        if (h.sessionPath.includes('archived_sessions')) return false;
        return cwdByPath.get(h.sessionPath) === selectedProjectKey;
      });
    } else {
      list = list.filter(
        (h) => h.projectKey === selectedProjectKey && !h.sessionPath.includes('archived_sessions')
      );
    }
    if (starredOnly) list = list.filter((h) => scan.stars[h.sessionPath]);
    return list;
  }, [searchHits, selectedProjectKey, starredOnly, scan.stars, scan.codex, tab, codexGrouping]);

  const onDelete = useCallback(
    async (s: SessionSummary) => {
      const ok = await confirm({
        title: '删除这次会话？',
        description: (
          <>
            <div>
              <span className="font-medium text-ink-1">{s.projectLabel}</span>
              <span className="text-ink-5"> · {new Date(s.timestamp).toLocaleString('zh-CN')}</span>
            </div>
            <div className="mt-1 line-clamp-2 text-ink-4">{s.preview || '(空会话)'}</div>
            <div className="mt-3 text-[12px] text-ink-5">
              会被移动到回收站，可随时打开 ~/.claude-manager/trash 还原。
            </div>
          </>
        ),
        confirmLabel: '删除'
      });
      if (!ok) return;
      try {
        await api.deleteSession(s.source, s.path);
        if (tab === 'claude') {
          setScan((prev) => ({
            ...prev,
            claude: prev.claude.map((p) => ({
              ...p,
              sessions: p.sessions.filter((x) => x.path !== s.path)
            })),
            stars: { ...prev.stars, [s.path]: false }
          }));
        } else {
          setScan((prev) => ({
            ...prev,
            codex: prev.codex.filter((x) => x.path !== s.path),
            stars: { ...prev.stars, [s.path]: false }
          }));
        }
        if (openSession?.path === s.path) setOpenSession(null);
      } catch (e: any) {
        setError(`删除失败: ${e?.message ?? String(e)}`);
      }
    },
    [tab, openSession, confirm]
  );

  const onToggleStar = useCallback(
    async (s: SessionSummary) => {
      const next = !scan.stars[s.path];
      setScan((prev) => ({ ...prev, stars: { ...prev.stars, [s.path]: next } }));
      try {
        await api.toggleStar(s.path, next);
      } catch (e: any) {
        setScan((prev) => ({ ...prev, stars: { ...prev.stars, [s.path]: !next } }));
        setError(`收藏失败: ${e?.message ?? String(e)}`);
      }
    },
    [scan.stars]
  );

  const onDeleteProject = useCallback(
    async (projectKey: string, label: string, count: number) => {
      const ok = await confirm({
        title: `删除整个项目「${label}」？`,
        description: (
          <>
            <div>
              它包含 <span className="font-medium text-ink-1">{count}</span> 个会话，全部会被一并移动到回收站。
            </div>
            <div className="mt-3 text-[12px] text-ink-5">
              可在 ~/.claude-manager/trash/claude/__projects 找回。
            </div>
          </>
        ),
        confirmLabel: '删除项目'
      });
      if (!ok) return;
      try {
        await api.deleteClaudeProject(projectKey);
        setScan((prev) => ({
          ...prev,
          claude: prev.claude.filter((p) => p.key !== projectKey)
        }));
        if (selectedProjectKey === projectKey) setSelectedProjectKey('__all__');
      } catch (e: any) {
        setError(`项目删除失败: ${e?.message ?? String(e)}`);
      }
    },
    [selectedProjectKey, confirm]
  );

  const onArchive = useCallback(
    async (s: SessionSummary) => {
      if (s.source !== 'codex') return;
      const wasArchived = !!s.archived;
      const wasStarred = !!scan.stars[s.path];
      try {
        const res = wasArchived
          ? await api.codexUnarchive(s.path)
          : await api.codexArchive(s.path);
        if (wasStarred) {
          await api.toggleStar(s.path, false).catch(() => {});
          await api.toggleStar(res.newPath, true).catch(() => {});
        }
        setScan((prev) => ({
          ...prev,
          codex: prev.codex.map((x) =>
            x.path === s.path ? { ...x, path: res.newPath, archived: !wasArchived } : x
          ),
          stars: wasStarred
            ? { ...prev.stars, [s.path]: false, [res.newPath]: true }
            : prev.stars
        }));
        if (openSession?.path === s.path) {
          setOpenSession({ ...s, path: res.newPath, archived: !wasArchived });
        }
      } catch (e: any) {
        setError(`${wasArchived ? '取消归档' : '归档'}失败: ${e?.message ?? String(e)}`);
      }
    },
    [openSession, scan.stars]
  );

  const onOpenTerminal = useCallback(async (s: SessionSummary) => {
    const res = await api.terminalOpen({
      source: s.source,
      sessionPath: s.path,
      cwd: s.cwd
    });
    if (!res.ok) setError(translateTerminalError(res.error));
  }, []);

  const switchTab = useCallback((t: Source) => {
    setTab(t);
    setSelectedProjectKey('__all__');
    setView('main');
  }, []);

  const shortcutHandlers = useMemo(
    () => ({
      onTogglePalette: () => {
        setPaletteInitialView('commands');
        setPaletteOpen((o) => !o);
      },
      onOpenSettings: () => setSettingsOpen(true),
      onSwitchClaude: () => switchTab('claude'),
      onSwitchCodex: () => switchTab('codex'),
      onFocusSearch: () => {
        if (view === 'trash') return;
        focusSearchInput();
      },
      onToggleTrash: () => setView((v) => (v === 'trash' ? 'main' : 'trash')),
      onToggleStarredOnly: () => {
        if (view === 'trash') return;
        setStarredOnly((v) => !v);
      },
      onOpenShortcutsHelp: () => {
        setPaletteInitialView('shortcuts');
        setPaletteOpen(true);
      }
    }),
    [switchTab, view]
  );

  useGlobalShortcuts(shortcutHandlers);

  return (
    <div className="flex h-full flex-col bg-canvas">
      <Header
        tab={tab}
        onTabChange={(t) => {
          setTab(t);
          setSelectedProjectKey('__all__');
        }}
        onRefresh={refresh}
        onToggleTrash={() => setView((v) => (v === 'trash' ? 'main' : 'trash'))}
        onOpenPalette={() => {
          setPaletteInitialView('commands');
          setPaletteOpen(true);
        }}
        view={view}
        loading={scan.loading}
        counts={{ claude: scan.claude.reduce((n, p) => n + p.sessions.length, 0), codex: scan.codex.length }}
      />
      {error && (
        <div className="flex items-center gap-3 border-b border-danger-100 bg-danger-50 px-4 py-2 text-sm text-danger-600">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="rounded px-2 py-0.5 text-xs hover:bg-surface">
            关闭
          </button>
        </div>
      )}
      {view === 'trash' ? (
        <TrashView onBack={() => setView('main')} onAfterRestore={refresh} />
      ) : (
        <div className="flex min-h-0 flex-1">
          <ProjectSidebar
            tab={tab}
            projects={projects}
            totalForTab={tab === 'codex' ? allSessions.length - archivedCodexCount : allSessions.length}
            archivedCount={tab === 'codex' ? archivedCodexCount : undefined}
            selectedKey={selectedProjectKey}
            onSelect={setSelectedProjectKey}
            onDeleteProject={tab === 'claude' ? onDeleteProject : undefined}
            onOpenSettings={() => setSettingsOpen(true)}
            codexGrouping={tab === 'codex' ? codexGrouping : undefined}
            onCodexGroupingChange={(g) => {
              setCodexGrouping(g);
              // Selected key is grouping-specific (cwd vs YYYY-MM); reset to
              // "全部" so we don't leave the user on a phantom bucket.
              setSelectedProjectKey('__all__');
            }}
          />
          <SessionList
            sessions={filtered}
            stars={scan.stars}
            query={query}
            onQuery={setQuery}
            starredOnly={starredOnly}
            onToggleStarredOnly={() => setStarredOnly((v) => !v)}
            onOpen={(s, jumpToEvent, hl) => {
              setOpenSession(s);
              setOpenJump({ eventIndex: jumpToEvent, query: hl });
            }}
            onDelete={onDelete}
            onToggleStar={onToggleStar}
            onSummarize={(s) => setSummarizeTarget(s)}
            onArchive={onArchive}
            onOpenTerminal={onOpenTerminal}
            loading={scan.loading}
            searchHits={filteredHits}
            searching={searching}
            searchError={searchError}
          />
        </div>
      )}
      <DetailDrawer
        session={openSession}
        onClose={() => {
          setOpenSession(null);
          setOpenJump({});
        }}
        jumpToEvent={openJump.eventIndex}
        highlightQuery={openJump.query}
      />
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        appearance={appearance}
        onAppearanceChange={setAppearance}
        trashDir={trashDir}
        onTrashDirChange={setTrashDir}
      />
      <SummarizeDialog
        open={!!summarizeTarget}
        session={summarizeTarget}
        onOpenChange={(o) => {
          if (!o) setSummarizeTarget(null);
        }}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        initialView={paletteInitialView}
        tab={tab}
        view={view}
        starredOnly={starredOnly}
        appearance={appearance}
        codexGrouping={codexGrouping}
        onTabChange={switchTab}
        onToggleTrash={() => setView((v) => (v === 'trash' ? 'main' : 'trash'))}
        onToggleStarredOnly={() => setStarredOnly((v) => !v)}
        onAppearanceChange={setAppearance}
        onCodexGroupingChange={(g) => {
          setCodexGrouping(g);
          setSelectedProjectKey('__all__');
        }}
        onRefresh={refresh}
        onOpenSettings={() => setSettingsOpen(true)}
        onFocusSearch={() => {
          if (view !== 'trash') focusSearchInput();
        }}
        onOpenSession={(s) => {
          setOpenSession(s);
          setOpenJump({});
        }}
      />
    </div>
  );
}
