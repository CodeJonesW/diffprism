import { GitBranch, FileCode, Clock, Radio, X } from "lucide-react";
import { NotificationToggle } from "../NotificationToggle";
import type { NotificationPermission } from "../../hooks/useNotifications.js";
import type { SessionSummary } from "../../types";

interface SessionListProps {
  sessions: SessionSummary[];
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onClose?: (sessionId: string) => void;
  notificationPermission?: NotificationPermission;
  notificationsEnabled?: boolean;
  onToggleNotifications?: () => void;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function getProjectName(projectPath: string): string {
  const parts = projectPath.split("/");
  return parts[parts.length - 1] || projectPath;
}

function statusBadge(session: SessionSummary) {
  const { status, decision } = session;

  if (status === "pending") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded bg-yellow-600/20 text-yellow-400 border border-yellow-500/30">
        Pending
      </span>
    );
  }

  if (status === "in_review") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded bg-accent/20 text-accent border border-accent/30">
        In Review
      </span>
    );
  }

  // status === "submitted" — show decision-specific badge
  if (decision === "changes_requested") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded bg-red-600/20 text-red-400 border border-red-500/30">
        Changes Requested
      </span>
    );
  }

  if (decision === "approved" || decision === "approved_with_comments") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded bg-green-600/20 text-green-400 border border-green-500/30">
        Approved
      </span>
    );
  }

  if (decision === "dismissed") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded bg-gray-600/20 text-gray-400 border border-gray-500/30">
        Dismissed
      </span>
    );
  }

  // Fallback for submitted without a decision
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded bg-green-600/20 text-green-400 border border-green-500/30">
      Submitted
    </span>
  );
}

export function SessionList({ sessions, activeSessionId, onSelect, onClose, notificationPermission, notificationsEnabled, onToggleNotifications }: SessionListProps) {
  if (sessions.length === 0) {
    return (
      <div className="flex flex-col h-full bg-background">
        {onToggleNotifications && notificationPermission && (
          <div className="flex justify-end px-6 pt-4">
            <NotificationToggle
              permission={notificationPermission}
              enabled={notificationsEnabled ?? false}
              onToggle={onToggleNotifications}
            />
          </div>
        )}
        <div className="flex flex-1 flex-col items-center justify-center text-center px-8">
          <div className="w-12 h-12 rounded-full bg-surface border border-border flex items-center justify-center mb-4">
            <FileCode className="w-6 h-6 text-text-secondary" />
          </div>
          <h2 className="text-text-primary text-lg font-semibold mb-2">
            No reviews yet
          </h2>
          <p className="text-text-secondary text-sm max-w-xs">
            Reviews from Claude Code sessions will appear here when they use the{" "}
            <code className="text-accent text-xs">open_review</code> tool.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div>
          <h2 className="text-text-primary text-sm font-semibold">
            Review Sessions
          </h2>
          <span className="text-text-secondary text-xs">
            {sessions.length} session{sessions.length !== 1 ? "s" : ""}
          </span>
        </div>
        {onToggleNotifications && notificationPermission && (
          <NotificationToggle
            permission={notificationPermission}
            enabled={notificationsEnabled ?? false}
            onToggle={onToggleNotifications}
          />
        )}
      </div>

      {/* Session cards */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {sessions.map((session) => {
          const isActive = session.id === activeSessionId;

          return (
            <div
              key={session.id}
              className={`relative w-full text-left px-4 py-3 rounded-lg border transition-colors cursor-pointer ${
                isActive
                  ? "bg-accent/10 border-accent/40"
                  : "bg-surface border-border hover:border-text-secondary/30"
              }`}
              onClick={() => onSelect(session.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onSelect(session.id);
              }}
            >
              {/* Close button */}
              {onClose && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(session.id);
                  }}
                  className="absolute top-2 right-2 p-1 rounded hover:bg-border/50 text-text-secondary hover:text-text-primary transition-colors"
                  title="Dismiss session"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}

              {/* Title + status */}
              <div className="flex items-center justify-between mb-1.5 pr-6">
                <div className="flex items-center gap-2 min-w-0 mr-2">
                  {session.hasNewChanges && (
                    <Radio className="w-3 h-3 text-accent flex-shrink-0 animate-pulse" />
                  )}
                  <span className="text-text-primary text-sm font-medium truncate">
                    {session.title || getProjectName(session.projectPath)}
                  </span>
                </div>
                {statusBadge(session)}
              </div>

              {/* Branch + project */}
              <div className="flex items-center gap-3 mb-1.5">
                {session.branch && (
                  <span className="flex items-center gap-1 text-text-secondary text-xs">
                    <GitBranch className="w-3 h-3" />
                    {session.branch}
                  </span>
                )}
                <span className="text-text-secondary text-xs truncate">
                  {getProjectName(session.projectPath)}
                </span>
              </div>

              {/* Stats */}
              <div className="flex items-center gap-3">
                <span className="text-text-secondary text-xs">
                  {session.fileCount} file{session.fileCount !== 1 ? "s" : ""}
                </span>
                {session.additions > 0 && (
                  <span className="text-green-400 text-xs font-mono">
                    +{session.additions}
                  </span>
                )}
                {session.deletions > 0 && (
                  <span className="text-red-400 text-xs font-mono">
                    -{session.deletions}
                  </span>
                )}
                <span className="flex items-center gap-1 text-text-secondary text-xs ml-auto">
                  <Clock className="w-3 h-3" />
                  {formatTime(session.createdAt)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
