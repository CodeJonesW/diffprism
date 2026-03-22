import { GitBranch, GitPullRequest, Clock, X, AlertCircle, FolderOpen, Plus } from "lucide-react";
import type { SessionSummary } from "../../types";
import { STATUS_BADGE_STYLES } from "../../lib/semantic-colors";

interface SessionSidebarProps {
  sessions: SessionSummary[];
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  onOpenProject?: () => void;
  onReviewPr?: () => void;
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d ago`;
}

function getProjectName(projectPath: string): string {
  // GitHub PR sessions: "github:owner/repo#123" → "owner/repo#123"
  if (projectPath.startsWith("github:")) {
    return projectPath.slice(7);
  }
  const parts = projectPath.split("/");
  return parts[parts.length - 1] || projectPath;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  in_review: "In Review",
  changes_requested: "Changes Req.",
  approved: "Approved",
  approved_with_comments: "Approved",
  dismissed: "Dismissed",
  submitted: "Submitted",
};

function statusBadge(session: SessionSummary) {
  const { status, decision } = session;
  const key = status === "submitted" ? (decision ?? "submitted") : status;
  const style = STATUS_BADGE_STYLES[key] ?? STATUS_BADGE_STYLES.submitted;
  const label = STATUS_LABELS[key] ?? STATUS_LABELS.submitted;

  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded ${style}`}>
      {label}
    </span>
  );
}

export function SessionSidebar({ sessions, activeSessionId, onSelect, onClose, onOpenProject, onReviewPr }: SessionSidebarProps) {
  return (
    <div className="flex flex-col h-full bg-surface border-r border-border">
      {/* Header */}
      <div className="px-3 py-3 border-b border-border flex items-center justify-between">
        <div>
          <h2 className="text-text-primary text-xs font-semibold uppercase tracking-wider">
            Sessions
          </h2>
          <span className="text-text-secondary text-[10px]">
            {sessions.length} session{sessions.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {onReviewPr && (
            <button
              onClick={onReviewPr}
              className="p-1 rounded hover:bg-border/50 text-text-secondary hover:text-accent transition-colors"
              title="Review GitHub PR"
            >
              <GitPullRequest className="w-3.5 h-3.5" />
            </button>
          )}
          {onOpenProject && (
            <button
              onClick={onOpenProject}
              className="p-1 rounded hover:bg-border/50 text-text-secondary hover:text-text-primary transition-colors"
              title="Open project"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Session entries */}
      <div className="flex-1 overflow-y-auto">
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-4 text-center">
            <p className="text-text-secondary text-xs">
              No sessions yet. Reviews will appear here automatically.
            </p>
          </div>
        ) : (
          <div className="py-1">
            {sessions.map((session) => {
              const isActive = session.id === activeSessionId;
              const isManual = session.source === "manual";
              const isGitHubPr = session.projectPath.startsWith("github:");

              return (
                <div
                  key={session.id}
                  className={`group relative px-3 py-2.5 cursor-pointer border-l-2 transition-colors ${
                    isActive
                      ? "bg-accent/10 border-l-accent"
                      : session.needsAttention
                        ? "bg-warning/5 border-l-warning hover:bg-warning/10"
                        : "border-l-transparent hover:bg-border/20"
                  }`}
                  onClick={() => onSelect(session.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") onSelect(session.id);
                  }}
                >
                  {/* Close button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onClose(session.id);
                    }}
                    className="absolute top-1.5 right-1.5 p-0.5 rounded hover:bg-border/50 text-text-secondary hover:text-text-primary transition-colors opacity-0 group-hover:opacity-100"
                    style={{ opacity: isActive ? 1 : undefined }}
                    title="Dismiss session"
                  >
                    <X className="w-3 h-3" />
                  </button>

                  {/* Row 1: Title + attention/status */}
                  <div className="flex items-start justify-between gap-1.5 mb-1 pr-7">
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      {session.needsAttention && (
                        <AlertCircle className="w-3.5 h-3.5 text-warning flex-shrink-0 animate-pulse" />
                      )}
                      {isGitHubPr ? (
                        <GitPullRequest className="w-3.5 h-3.5 text-accent flex-shrink-0" />
                      ) : isManual ? (
                        <FolderOpen className="w-3.5 h-3.5 text-text-secondary flex-shrink-0" />
                      ) : null}
                      <span className="text-text-primary text-xs font-medium truncate">
                        {session.title || getProjectName(session.projectPath)}
                      </span>
                    </div>
                    <div className="flex-shrink-0">
                      {statusBadge(session)}
                    </div>
                  </div>

                  {/* Row 2: Reasoning subtitle */}
                  {session.reasoning && (
                    <p className="text-text-secondary text-[11px] leading-tight mb-1 line-clamp-2">
                      {session.reasoning}
                    </p>
                  )}

                  {/* Row 3: Branch + timestamp metadata */}
                  <div className="flex items-center gap-2 text-[10px] text-text-secondary">
                    {session.branch && (
                      <span className="flex items-center gap-0.5 truncate">
                        <GitBranch className="w-2.5 h-2.5" />
                        {session.branch}
                      </span>
                    )}
                    <span className="flex items-center gap-0.5 ml-auto flex-shrink-0">
                      <Clock className="w-2.5 h-2.5" />
                      {formatRelativeTime(session.createdAt)}
                    </span>
                  </div>

                  {/* Row 4: File stats */}
                  <div className="flex items-center gap-2 mt-0.5 text-[10px]">
                    <span className="text-text-secondary">
                      {session.fileCount} file{session.fileCount !== 1 ? "s" : ""}
                    </span>
                    {session.additions > 0 && (
                      <span className="text-success font-mono">+{session.additions}</span>
                    )}
                    {session.deletions > 0 && (
                      <span className="text-danger font-mono">-{session.deletions}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
