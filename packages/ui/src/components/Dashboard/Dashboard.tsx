import { SessionSidebar } from "../SessionSidebar";
import { ReviewView } from "../ReviewView";
import { NotificationToggle } from "../NotificationToggle";
import type { NotificationPermission } from "../../hooks/useNotifications";
import type { ReviewResult, SessionSummary } from "../../types";
import { FileCode, Terminal, Settings, FolderOpen, Folder, ChevronUp, GitBranch } from "lucide-react";
import { useState, useEffect, useCallback } from "react";

const DIFF_REF_OPTIONS = [
  { value: "working-copy", label: "Working Copy" },
  { value: "unstaged", label: "Unstaged" },
  { value: "staged", label: "Staged" },
] as const;

interface DashboardProps {
  sessions: SessionSummary[];
  activeSessionId: string | null;
  hasDiffLoaded: boolean;
  onSelectSession: (sessionId: string) => void;
  onCloseSession: (sessionId: string) => void;
  onSubmit: (result: ReviewResult) => void;
  onDismiss: () => void;
  notificationPermission?: NotificationPermission;
  notificationsEnabled?: boolean;
  onToggleNotifications?: () => void;
}

function getHttpPort(): string | null {
  return new URLSearchParams(window.location.search).get("httpPort");
}

interface DirEntry {
  name: string;
  path: string;
  isGitRepo: boolean;
}

interface DirListing {
  path: string;
  parentPath: string | null;
  isGitRepo: boolean;
  dirs: DirEntry[];
}

function useDirListing(initialPath?: string) {
  const [listing, setListing] = useState<DirListing | null>(null);
  const [loadingDir, setLoadingDir] = useState(false);

  const fetchDir = useCallback(async (dirPath?: string) => {
    const httpPort = getHttpPort();
    if (!httpPort) return;

    setLoadingDir(true);
    try {
      const query = dirPath ? `?path=${encodeURIComponent(dirPath)}` : "";
      const res = await fetch(`http://localhost:${httpPort}/api/fs/list${query}`);
      if (res.ok) {
        const data = await res.json() as DirListing;
        setListing(data);
      }
    } catch {
      // silently fail
    } finally {
      setLoadingDir(false);
    }
  }, []);

  useEffect(() => {
    fetchDir(initialPath);
  }, [fetchDir, initialPath]);

  return { listing, loadingDir, fetchDir };
}

interface OpenProjectFormProps {
  onSuccess?: () => void;
}

function OpenProjectForm({ onSuccess }: OpenProjectFormProps) {
  const [serverCwd, setServerCwd] = useState<string | undefined>();
  const [diffRef, setDiffRef] = useState("working-copy");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { listing, loadingDir, fetchDir } = useDirListing(serverCwd);

  // Get server cwd to seed the initial listing
  useEffect(() => {
    const httpPort = getHttpPort();
    if (!httpPort) return;

    fetch(`http://localhost:${httpPort}/api/status`)
      .then((res) => res.json())
      .then((data) => {
        const status = data as { cwd?: string };
        if (status.cwd) setServerCwd(status.cwd);
      })
      .catch(() => {});
  }, []);

  const handleOpen = useCallback(async (projectPath: string) => {
    const httpPort = getHttpPort();
    if (!httpPort) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`http://localhost:${httpPort}/api/projects/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectPath, diffRef }),
      });
      const data = await res.json() as { error?: string; sessionId?: string };

      if (!res.ok) {
        setError(data.error ?? "Failed to open project");
      } else {
        onSuccess?.();
      }
    } catch {
      setError("Could not connect to server");
    } finally {
      setLoading(false);
    }
  }, [diffRef, onSuccess]);

  return (
    <div className="space-y-3">
      {/* Current path breadcrumb */}
      {listing && (
        <div className="flex items-center gap-1 text-text-secondary text-[11px] font-mono truncate min-h-[20px]">
          {listing.parentPath && (
            <button
              onClick={() => fetchDir(listing.parentPath!)}
              className="p-0.5 rounded hover:bg-border/50 hover:text-text-primary transition-colors flex-shrink-0"
              title="Go up"
            >
              <ChevronUp className="w-3 h-3" />
            </button>
          )}
          <span className="truncate">{listing.path}</span>
          {listing.isGitRepo && (
            <GitBranch className="w-3 h-3 text-success flex-shrink-0 ml-1" />
          )}
        </div>
      )}

      {/* Open current directory button (if it's a git repo) */}
      {listing?.isGitRepo && (
        <button
          onClick={() => handleOpen(listing.path)}
          disabled={loading}
          className="w-full bg-accent/15 text-accent text-xs font-medium rounded px-3 py-2 hover:bg-accent/25 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5"
        >
          <FolderOpen className="w-3.5 h-3.5" />
          {loading ? "Opening..." : `Open ${listing.path.split("/").pop()}`}
        </button>
      )}

      {/* Directory listing */}
      <div className="border border-border rounded max-h-[280px] overflow-y-auto">
        {loadingDir ? (
          <div className="px-3 py-4 text-text-secondary text-xs text-center">Loading...</div>
        ) : listing?.dirs.length === 0 ? (
          <div className="px-3 py-4 text-text-secondary text-xs text-center">No subdirectories</div>
        ) : (
          listing?.dirs.map((dir) => (
            <button
              key={dir.path}
              onClick={() => {
                setError(null);
                if (dir.isGitRepo) {
                  // Navigate into it so user can see it and open
                  fetchDir(dir.path);
                } else {
                  fetchDir(dir.path);
                }
              }}
              onDoubleClick={() => {
                if (dir.isGitRepo) handleOpen(dir.path);
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-border/30 transition-colors group"
            >
              <Folder className={`w-3.5 h-3.5 flex-shrink-0 ${dir.isGitRepo ? "text-accent" : "text-text-secondary"}`} />
              <span className="text-text-primary text-xs truncate flex-1">{dir.name}</span>
              {dir.isGitRepo && (
                <GitBranch className="w-3 h-3 text-success flex-shrink-0" />
              )}
            </button>
          ))
        )}
      </div>

      {/* Diff scope selector */}
      <div>
        <label className="block text-text-secondary text-xs mb-1">Diff scope</label>
        <select
          value={diffRef}
          onChange={(e) => setDiffRef(e.target.value)}
          className="w-full bg-background border border-border rounded px-3 py-1.5 text-text-primary text-xs focus:outline-none focus:border-accent"
        >
          {DIFF_REF_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {error && (
        <p className="text-danger text-xs">{error}</p>
      )}
    </div>
  );
}

export function Dashboard({
  sessions,
  activeSessionId,
  hasDiffLoaded,
  onSelectSession,
  onCloseSession,
  onSubmit,
  onDismiss,
  notificationPermission,
  notificationsEnabled,
  onToggleNotifications,
}: DashboardProps) {
  const [showOpenProject, setShowOpenProject] = useState(false);

  return (
    <div className="h-screen flex bg-background">
      {/* Session sidebar — always visible */}
      <div className="w-[260px] flex-shrink-0 flex flex-col">
        <SessionSidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelect={onSelectSession}
          onClose={onCloseSession}
          onOpenProject={() => setShowOpenProject(true)}
        />
        {/* Notification toggle at bottom of sidebar */}
        {onToggleNotifications && notificationPermission && (
          <div className="px-3 py-2 border-t border-border border-r border-r-border bg-surface">
            <NotificationToggle
              permission={notificationPermission}
              enabled={notificationsEnabled ?? false}
              onToggle={onToggleNotifications}
            />
          </div>
        )}
      </div>

      {/* Detail pane — review or empty state */}
      <div className="flex-1 min-w-0">
        {hasDiffLoaded ? (
          <ReviewView
            onSubmit={onSubmit}
            onDismiss={onDismiss}
            isWatchMode={true}
            watchSubmitted={false}
            hasUnreviewedChanges={true}
          />
        ) : showOpenProject ? (
          <div className="flex flex-col items-center justify-center h-full px-8">
            <div className="max-w-sm w-full">
              <div className="flex items-center gap-2 mb-4">
                <FolderOpen className="w-5 h-5 text-accent" />
                <h2 className="text-text-primary text-lg font-semibold">Open Project</h2>
              </div>
              <div className="bg-surface border border-border rounded-lg p-5">
                <OpenProjectForm onSuccess={() => setShowOpenProject(false)} />
              </div>
              <button
                onClick={() => setShowOpenProject(false)}
                className="mt-3 text-text-secondary text-xs hover:text-text-primary transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <EmptyDetailPane hasAnySessions={sessions.length > 0} onOpenProject={() => setShowOpenProject(true)} />
        )}
      </div>
    </div>
  );
}

function EmptyDetailPane({ hasAnySessions, onOpenProject }: { hasAnySessions: boolean; onOpenProject: () => void }) {
  if (hasAnySessions) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-8">
        <div className="w-14 h-14 rounded-full bg-surface border border-border flex items-center justify-center mb-4">
          <FileCode className="w-7 h-7 text-text-secondary" />
        </div>
        <h2 className="text-text-primary text-lg font-semibold mb-2">
          Select a session
        </h2>
        <p className="text-text-secondary text-sm max-w-sm mb-4">
          Click a session in the sidebar to view its diff, annotations, and submit your review.
        </p>
        <button
          onClick={onOpenProject}
          className="flex items-center gap-1.5 text-accent text-xs font-medium hover:text-accent/80 transition-colors"
        >
          <FolderOpen className="w-3.5 h-3.5" />
          Open Project
        </button>
      </div>
    );
  }

  return <OnboardingPane onOpenProject={onOpenProject} />;
}

function OnboardingPane({ onOpenProject }: { onOpenProject: () => void }) {
  const [serverStatus, setServerStatus] = useState<{
    pid: number;
    uptime: number;
  } | null>(null);

  useEffect(() => {
    const httpPort = getHttpPort();
    if (!httpPort) return;

    fetch(`http://localhost:${httpPort}/api/status`)
      .then((res) => res.json())
      .then((data) => {
        const status = data as { pid: number; uptime: number };
        setServerStatus(status);
      })
      .catch(() => {});
  }, []);

  const formatUptime = (seconds: number): string => {
    if (seconds < 60) return `${Math.floor(seconds)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  };

  return (
    <div className="flex flex-col items-center justify-center h-full px-8">
      <div className="max-w-md w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-text-primary text-2xl font-bold mb-1">DiffPrism</h1>
          <p className="text-text-secondary text-sm">
            Code review for AI-generated changes
          </p>
        </div>

        {/* Open Project button */}
        <button
          onClick={onOpenProject}
          className="w-full flex items-center justify-center gap-2 bg-accent/15 text-accent text-sm font-medium rounded-lg px-4 py-3 hover:bg-accent/25 transition-colors mb-4"
        >
          <FolderOpen className="w-4 h-4" />
          Open Project
        </button>

        {/* Getting Started card */}
        <div className="bg-surface border border-border rounded-lg p-6">
          <h2 className="text-text-primary text-sm font-semibold mb-4">Getting Started</h2>

          {/* From the terminal */}
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-2">
              <Terminal className="w-4 h-4 text-text-secondary" />
              <span className="text-text-secondary text-xs font-medium">From the terminal</span>
            </div>
            <div className="space-y-1.5 pl-6">
              <code className="block text-accent text-xs">$ diffprism review</code>
              <code className="block text-accent text-xs">$ diffprism review --staged</code>
            </div>
          </div>

          {/* From Claude Code */}
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-2">
              <FileCode className="w-4 h-4 text-text-secondary" />
              <span className="text-text-secondary text-xs font-medium">From Claude Code</span>
            </div>
            <p className="text-text-secondary text-xs pl-6">
              Type <code className="text-accent">/review</code> or use the{" "}
              <code className="text-accent">open_review</code> MCP tool
            </p>
          </div>

          {/* First time */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Settings className="w-4 h-4 text-text-secondary" />
              <span className="text-text-secondary text-xs font-medium">First time?</span>
            </div>
            <div className="pl-6">
              <code className="block text-accent text-xs mb-1">$ diffprism setup</code>
              <p className="text-text-secondary text-xs">
                Configures Claude Code integration in one command
              </p>
            </div>
          </div>
        </div>

        {/* Server status footer */}
        {serverStatus && (
          <p className="text-text-secondary text-xs text-center mt-4">
            Server running · PID {serverStatus.pid} · up {formatUptime(serverStatus.uptime)}
          </p>
        )}
      </div>
    </div>
  );
}
