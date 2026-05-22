import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import type { ClaudeProject, SessionSummary, Source } from './types';
import Header from './components/Header';
import ProjectSidebar from './components/ProjectSidebar';
import SessionList from './components/SessionList';
import DetailDrawer from './components/DetailDrawer';
import { useConfirm } from './components/ConfirmDialog';

type ScanState = {
  loading: boolean;
  claude: ClaudeProject[];
  codex: SessionSummary[];
  stars: Record<string, boolean>;
};

const INITIAL_SCAN: ScanState = { loading: true, claude: [], codex: [], stars: {} };

export default function App(): JSX.Element {
  const [tab, setTab] = useState<Source>('claude');
  const [scan, setScan] = useState<ScanState>(INITIAL_SCAN);
  const [query, setQuery] = useState('');
  const [starredOnly, setStarredOnly] = useState(false);
  const [selectedProjectKey, setSelectedProjectKey] = useState<string>('__all__');
  const [openSession, setOpenSession] = useState<SessionSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();

  // Tab-aware theme: claude=orange, codex=blue
  useEffect(() => {
    document.documentElement.dataset.theme = tab;
  }, [tab]);

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
      } catch {
        // first run
      }
      await refresh();
    })();
  }, [refresh]);

  useEffect(() => {
    api
      .getConfig()
      .then((cfg) => api.setConfig({ ...cfg, activeTab: tab, showStarredOnly: starredOnly }))
      .catch(() => {});
  }, [tab, starredOnly]);

  const allSessions = useMemo<SessionSummary[]>(() => {
    if (tab === 'claude') return scan.claude.flatMap((p) => p.sessions);
    return scan.codex;
  }, [tab, scan]);

  const projects = useMemo(() => {
    if (tab === 'claude') {
      return scan.claude.map((p) => ({ key: p.key, label: p.label, count: p.sessions.length }));
    }
    const map = new Map<string, number>();
    for (const s of scan.codex) map.set(s.projectKey, (map.get(s.projectKey) ?? 0) + 1);
    return [...map.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([k, v]) => ({ key: k, label: k, count: v }));
  }, [tab, scan]);

  const filtered = useMemo(() => {
    let list = allSessions;
    if (selectedProjectKey !== '__all__')
      list = list.filter((s) => s.projectKey === selectedProjectKey);
    if (starredOnly) list = list.filter((s) => scan.stars[s.path]);
    const q = query.trim().toLowerCase();
    if (q)
      list = list.filter(
        (s) =>
          s.preview.toLowerCase().includes(q) ||
          s.projectLabel.toLowerCase().includes(q) ||
          s.id.toLowerCase().includes(q)
      );
    return list;
  }, [allSessions, selectedProjectKey, query, starredOnly, scan.stars]);

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

  return (
    <div className="flex h-full flex-col bg-canvas">
      <Header
        tab={tab}
        onTabChange={(t) => {
          setTab(t);
          setSelectedProjectKey('__all__');
        }}
        onRefresh={refresh}
        onOpenTrash={() => api.openTrash()}
        loading={scan.loading}
        counts={{ claude: scan.claude.reduce((n, p) => n + p.sessions.length, 0), codex: scan.codex.length }}
      />
      {error && (
        <div className="flex items-center gap-3 border-b border-danger-100 bg-danger-50 px-4 py-2 text-sm text-danger-600">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="rounded px-2 py-0.5 text-xs hover:bg-white">
            关闭
          </button>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <ProjectSidebar
          tab={tab}
          projects={projects}
          totalForTab={allSessions.length}
          selectedKey={selectedProjectKey}
          onSelect={setSelectedProjectKey}
          onDeleteProject={tab === 'claude' ? onDeleteProject : undefined}
        />
        <SessionList
          sessions={filtered}
          stars={scan.stars}
          query={query}
          onQuery={setQuery}
          starredOnly={starredOnly}
          onToggleStarredOnly={() => setStarredOnly((v) => !v)}
          onOpen={setOpenSession}
          onDelete={onDelete}
          onToggleStar={onToggleStar}
          loading={scan.loading}
        />
      </div>
      <DetailDrawer session={openSession} onClose={() => setOpenSession(null)} />
    </div>
  );
}
