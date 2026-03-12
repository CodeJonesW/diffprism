import { SessionSidebar } from "../SessionSidebar";
import { ReviewView } from "../ReviewView";
import { NotificationToggle } from "../NotificationToggle";
import type { NotificationPermission } from "../../hooks/useNotifications";
import type { ReviewResult, SessionSummary } from "../../types";
import { FileCode, Terminal, Settings } from "lucide-react";
import { useState, useEffect } from "react";

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
  return (
    <div className="h-screen flex bg-background">
      {/* Session sidebar — always visible */}
      <div className="w-[260px] flex-shrink-0 flex flex-col">
        <SessionSidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelect={onSelectSession}
          onClose={onCloseSession}
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
        ) : (
          <EmptyDetailPane hasAnySessions={sessions.length > 0} />
        )}
      </div>
    </div>
  );
}

function EmptyDetailPane({ hasAnySessions }: { hasAnySessions: boolean }) {
  if (hasAnySessions) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-8">
        <div className="w-14 h-14 rounded-full bg-surface border border-border flex items-center justify-center mb-4">
          <FileCode className="w-7 h-7 text-text-secondary" />
        </div>
        <h2 className="text-text-primary text-lg font-semibold mb-2">
          Select a session
        </h2>
        <p className="text-text-secondary text-sm max-w-sm">
          Click a session in the sidebar to view its diff, annotations, and submit your review.
        </p>
      </div>
    );
  }

  return <OnboardingPane />;
}

function OnboardingPane() {
  const [serverStatus, setServerStatus] = useState<{
    pid: number;
    uptime: number;
  } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const httpPort = params.get("httpPort");
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
