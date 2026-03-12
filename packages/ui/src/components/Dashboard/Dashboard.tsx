import { SessionSidebar } from "../SessionSidebar";
import { ReviewView } from "../ReviewView";
import { NotificationToggle } from "../NotificationToggle";
import type { NotificationPermission } from "../../hooks/useNotifications";
import type { ReviewResult, SessionSummary } from "../../types";
import { FileCode } from "lucide-react";

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
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8">
      <div className="w-14 h-14 rounded-full bg-surface border border-border flex items-center justify-center mb-4">
        <FileCode className="w-7 h-7 text-text-secondary" />
      </div>
      {hasAnySessions ? (
        <>
          <h2 className="text-text-primary text-lg font-semibold mb-2">
            Select a session
          </h2>
          <p className="text-text-secondary text-sm max-w-sm">
            Click a session in the sidebar to view its diff, annotations, and submit your review.
          </p>
        </>
      ) : (
        <>
          <h2 className="text-text-primary text-lg font-semibold mb-2">
            No reviews yet
          </h2>
          <p className="text-text-secondary text-sm max-w-sm">
            Reviews from Claude Code sessions will appear here automatically when they use the{" "}
            <code className="text-accent text-xs">open_review</code> tool.
          </p>
        </>
      )}
    </div>
  );
}
